#include <M5StickCPlus.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>

#include <WiFiClientSecure.h>
#include <time.h>
#include "cloud_config.h"
#include "root_ca.h"

// These are experimental game thresholds; adjust after observing real readings.
constexpr unsigned long ARM_MS = 300;
constexpr unsigned long READY_TIMEOUT_MS = 5000;
constexpr unsigned long COOLDOWN_MS = 1000;
constexpr unsigned long SAMPLE_MS = 20;
constexpr unsigned long MAX_GESTURE_MS = 500;
constexpr float START_DELTA_G = 0.90f;
constexpr float MIN_PEAK_G = 2.20f;
constexpr float MIN_MOTION_SCORE = 0.07f; // integral of excess above 0.55g, over a short window

// Initial thresholds only: tune using real gentle-shake and throwing samples.
constexpr float MIN_GYRO_DPS = 250.0f;
constexpr unsigned long MIN_STRONG_MS = 60;
bool consumed = false, settled = false;
bool armed = false, released = false;
unsigned long stillMs = 0, strongMs = 0, quietMs = 0;
float gyroMagnitude = 0, peakGyro = 0;
bool previousDown = false, recording = false, hadThrow = false;
unsigned long pressedAt=0, beganAt=0, lastThrowAt=0, lastSample=0, lastDraw=0;
unsigned int throws = 0;
float magnitude = 1.0f, peakG = 0, motionScore = 0;
String statusText = "TAP A TO ARM";
String networkText = "WiFi connecting";
// StickC Plus red LED: GPIO10, active LOW (not the Plus2 pin).
constexpr int RED_LED_PIN = 10;
volatile int ledMode = 0; // 0 off, 1 waiting/blink, 2 captured/solid
bool waitingResult = false;
unsigned long pendingSequence = 0, waitingSince = 0, lastResultPoll = 0;
bool buddyPresent=false;
unsigned long lastEncounterPoll=0;
String buddyText="Waiting for phone";

void ledTask(void*) {
  for (;;) {
    const bool on = ledMode == 2 || (ledMode == 1 && (millis()/250)%2 == 0);
    digitalWrite(RED_LED_PIN, on ? LOW : HIGH);
    vTaskDelay(pdMS_TO_TICKS(25));
  }
}

String resultUrl() {
  String url(SERVER_URL);
  const int suffix = url.indexOf("/api/throw");
  if (suffix < 0) return String("");
  return url.substring(0, suffix) + "/api/result?sequence=" + String(pendingSequence);
}

void checkEncounter() {
  // Never stall IMU sampling while preparing or recording a gesture.
  if (armed || recording || waitingResult || millis()-lastEncounterPoll<2000) return;
  lastEncounterPoll=millis();
  if (WiFi.status()!=WL_CONNECTED || time(nullptr)<1700000000) { buddyText="Not connected"; return; }
  String url(SERVER_URL); const int suffix=url.indexOf("/api/throw");
  if (suffix<0) { buddyText="Check server URL"; return; }
  url=url.substring(0,suffix)+"/api/encounter";
  WiFiClientSecure client;client.setCACert(PACE_ROOT_CA);
  HTTPClient http;http.setTimeout(4000);
  if(!http.begin(client,url))return;
  http.addHeader("Authorization",String("Bearer ")+RELAY_TOKEN);
  const int code=http.GET();
  String value=code==200?http.getString():String("");value.trim();http.end();
  if(code!=200){buddyText="Sync error "+String(code);return;}
  const bool present=value=="present";
  if(value!="present" && value!="none"){buddyText="Update cloud API";return;}
  if(present&&!buddyPresent&&ledMode!=2&&!(statusText=="CAPTURE FAILED"))statusText="BUDDY APPEARED!";
  else if(!present&&buddyPresent&&statusText=="BUDDY APPEARED!")statusText="WAIT FOR BUDDY";
  buddyPresent=present;buddyText=present?"BUDDY IS HERE":"No buddy nearby";
}

void checkResult() {
  if (!waitingResult) return;
  const unsigned long now = millis();
  if (now-waitingSince >= 20000) {
    waitingResult=false; ledMode=0; statusText="RESULT TIMEOUT"; return;
  }
  if (now-lastResultPoll < 1000 || WiFi.status()!=WL_CONNECTED) return;
  lastResultPoll=now;
  WiFiClientSecure client; client.setCACert(PACE_ROOT_CA);
  HTTPClient http; http.setTimeout(4000);
  String url=resultUrl();
  if (!url.length() || !http.begin(client,url)) return;
  http.addHeader("Authorization",String("Bearer ")+RELAY_TOKEN);
  const int code=http.GET();
  String result=code==200?http.getString():String(""); result.trim();
  Serial.printf("Result #%lu: HTTP %d %s\n",pendingSequence,code,result.c_str());
  networkText=code==200?"Result: "+result:"Result HTTP "+String(code);
  http.end();
  if (millis()-waitingSince >= 20000) {
    waitingResult=false; ledMode=0; statusText="RESULT TIMEOUT"; return;
  }
  if (result=="success" || result=="failure" || result=="stale") {
    waitingResult=false;
    ledMode=result=="success"?2:0;
    statusText=result=="success"?"CAPTURE SUCCESS!":result=="failure"?"CAPTURE FAILED":"STALE: TAP A";
  }
}

void sendThrow(float peak, float score, unsigned long duration) {
  if (WiFi.status() != WL_CONNECTED) { networkText = "WiFi OFF"; return; }
  if (time(nullptr) < 1700000000) { networkText = "WAIT TIME SYNC"; return; }
  WiFiClientSecure client;
  client.setCACert(PACE_ROOT_CA);
  HTTPClient http;
  http.setTimeout(6000);
  if (!http.begin(client, SERVER_URL)) { networkText = "HTTPS INIT FAIL"; return; }
  http.addHeader("Authorization", String("Bearer ") + RELAY_TOKEN);
  http.addHeader("Content-Type", "application/json");
  const char* responseHeaders[] = {"X-Throw-Sequence"};
  http.collectHeaders(responseHeaders,1);
  String body = "{\"event\":\"throw\",\"peak_g\":" + String(peak, 2)
    + ",\"motion_score\":" + String(score, 3)
    + ",\"duration_ms\":" + String(duration) + "}";
  ledMode=1; // Flash while HTTPS submission and capture judgement are in progress.
  int code = http.POST(body);
  const long receivedSequence = code==200?http.header("X-Throw-Sequence").toInt():0;
  if (receivedSequence>0) {
    pendingSequence=(unsigned long)receivedSequence;
    waitingSince=millis(); lastResultPoll=waitingSince;
    waitingResult=true; ledMode=1; statusText="WAIT RESULT";
  } else { ledMode=0; if(code==200) statusText="UPDATE CLOUD API"; }
  Serial.printf("gesture: gyro %.1f strong_ms %lu\n", peakGyro, strongMs);
  networkText = (code == 200) ? "sent OK" : "HTTP " + String(code);
  Serial.printf("POST %d %s\n", code, body.c_str());
  http.end();
}

void completeGesture(unsigned long now) {
  if (!recording) return;
  recording = false;
  consumed = true;
  armed = false;
  unsigned long duration = now - beganAt;
  if (peakG >= MIN_PEAK_G && motionScore >= MIN_MOTION_SCORE && strongMs >= MIN_STRONG_MS && peakGyro >= MIN_GYRO_DPS) {
    throws++;
    hadThrow = true;
    lastThrowAt = now;
    statusText = "THROW!";
    sendThrow(peakG, motionScore, duration);
  } else {
    statusText = "TOO WEAK";
    Serial.printf("rejected: peak %.2f score %.3f gyro %.1f strong_ms %lu duration %lu\n", peakG, motionScore, peakGyro, strongMs, duration);
  }
}

void setup() {
  M5.begin(); Serial.begin(115200); M5.Imu.Init();
  pinMode(RED_LED_PIN,OUTPUT); digitalWrite(RED_LED_PIN,HIGH);
  xTaskCreate(ledTask,"pace-led",2048,nullptr,1,nullptr);
  M5.Lcd.setRotation(3);
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setTextColor(WHITE, BLACK);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println("PACE cloud v2.5: buddy arrival and capture outcome displayed on M5.");
}
void loop() {
  M5.update();
  unsigned long now = millis();
  bool down = M5.BtnA.isPressed();
  if (down && !previousDown && !armed && !waitingResult && (!hadThrow || now-lastThrowAt >= COOLDOWN_MS)) {
    ledMode=0;
    pressedAt = now;
    armed = true; released = false;
    consumed = false; settled = false; stillMs = strongMs = quietMs = 0; peakGyro = 0;
    recording = false;
    peakG = 0;
    motionScore = 0;
    statusText = "ARMING";
  }
  if (!down && previousDown && armed && !released) {
    released = true;
    pressedAt = now;
  }
  previousDown = down;
  if (armed && now-pressedAt >= READY_TIMEOUT_MS) {
    armed=false; recording=false; consumed=true; statusText="TIMEOUT: TAP A";
  }
  if (now - lastSample >= SAMPLE_MS) {
    unsigned long elapsed = lastSample ? now - lastSample : SAMPLE_MS;
    lastSample = now;
    float x=0,y=0,z=0,gx=0,gy=0,gz=0;
    M5.Imu.getAccelData(&x,&y,&z);
    M5.Imu.getGyroData(&gx,&gy,&gz);
    magnitude=sqrtf(x*x+y*y+z*z);
    gyroMagnitude=sqrtf(gx*gx+gy*gy+gz*gz);
    // A stalled loop must not turn one sample into a long strong gesture.
    if (elapsed > 80 && recording) {
      recording=false; consumed=true; armed=false; statusText="SAMPLE GAP";
    }
    if (isfinite(magnitude) && magnitude > 0.01f && isfinite(gyroMagnitude)) {
      bool cooled = !hadThrow || now - lastThrowAt >= COOLDOWN_MS;
      if (armed && released && !consumed && cooled && now - pressedAt >= ARM_MS) {
        const unsigned long dt = elapsed > 40 ? 20 : elapsed;
        float delta = fabsf(magnitude-1.0f);
        if (!settled) {
          if (delta < 0.20f && gyroMagnitude < 45.0f) stillMs += dt;
          else stillMs=0;
          if (stillMs >= 120) settled=true;
          statusText=settled ? "READY" : "HOLD STILL";
        } else {
          if (!recording && delta >= START_DELTA_G && gyroMagnitude >= 180.0f) {
            recording=true; beganAt=now; peakG=0; peakGyro=0;
            motionScore=0; strongMs=quietMs=0; statusText="SWINGING";
          }
          if (recording) {
            peakG=fmaxf(peakG,magnitude);
            peakGyro=fmaxf(peakGyro,gyroMagnitude);
            motionScore += fmaxf(0.0f,delta-0.55f)*(dt/1000.0f);
            // Require acceleration and rotation together, not separate peaks.
            if (delta >= 0.90f && gyroMagnitude >= MIN_GYRO_DPS) strongMs += dt;
            if (delta < 0.30f && gyroMagnitude < 100.0f) quietMs += dt;
            else quietMs=0;
            if (quietMs >= 80 || now-beganAt >= MAX_GESTURE_MS) completeGesture(now);
          }
        }
      } else if (armed && !released) statusText="RELEASE TO ARM";
      else if (down && !cooled) statusText="COOLDOWN";
    } else {
      recording=false; consumed=true; armed=false; statusText="CHECK IMU";
    }
  }

  if (now - lastDraw >= 150) {
    lastDraw=now;
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(4,4); M5.Lcd.printf("PACE CLOUD V2.5   ");
    M5.Lcd.setCursor(4,32); M5.Lcd.printf("%-19s",statusText.c_str());
    M5.Lcd.setCursor(4,60); M5.Lcd.printf("%-19s",buddyText.c_str());
    M5.Lcd.setTextSize(1);
    M5.Lcd.setCursor(4,90); M5.Lcd.printf("Throws:%u Peak:%.2fg           ",throws,peakG);
    M5.Lcd.setCursor(4,112); M5.Lcd.printf("WiFi:%s    ",WiFi.status()==WL_CONNECTED?"OK":"OFF");
    M5.Lcd.setCursor(4,125); M5.Lcd.printf("%-28s",networkText.c_str());
  }
  checkResult();
  checkEncounter();
  delay(2);
}
