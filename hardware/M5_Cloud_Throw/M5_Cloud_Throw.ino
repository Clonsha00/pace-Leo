#include <M5StickCPlus.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <math.h>
#include <time.h>
#include "cloud_config.h"
#include "root_ca.h"

constexpr int RED_LED_PIN=10;
constexpr unsigned long SAMPLE_MS=20, ARM_MS=300, READY_MS=5000, RESULT_MS=20000;
constexpr float START_DELTA_G=.90f, MIN_PEAK_G=2.20f, MIN_SCORE=.07f, MIN_GYRO=250;
enum Phase { OFFLINE, IDLE, FOUND, RELEASE_BUTTON, SETTLING, READY, SWING,
             SENDING, WAIT_RESULT, CAUGHT, ESCAPED, WEAK, ARM_TIMEOUT,
             RESULT_TIMEOUT, SYNC_ERROR, SEND_ERROR, IMU_ERROR, UPDATE_API, INIT_ERROR, AUTH_ERROR };
// One writer (loop) owns phase. LED task only reads it.
volatile Phase phase=OFFLINE;
enum ReplyKind { STATUS_REPLY, POST_REPLY };
struct ThrowJob { unsigned long revision; char encounter[81]; float peak,score; unsigned long duration; };
struct NetReply {
  ReplyKind kind; int code; unsigned long revision,sequence;
  bool wifi,clockReady,active,protocol;
  char encounter[81],result[16];
};
QueueHandle_t jobs=nullptr,replies=nullptr;
bool previousDown=false,armed=false,released=false,settled=false,recording=false;
bool buddy=false,online=false,clockReady=false,transportReady=false;
bool deviceReady=false;
char buddyId[81]="",caughtId[81]="",lastResult[20]="--";
unsigned long revision=0,pendingSequence=0,pressedAt=0,beganAt=0;
unsigned long lastSample=0,lastDraw=0,lastSync=0,lastThrow=0,phaseAt=0;
unsigned long stillMs=0,strongMs=0,quietMs=0;
unsigned int throws=0;
int lastHttp=0;
float peakG=0,score=0,peakGyro=0;
// Explicit declarations keep Arduino's auto-prototypes behind our custom types.
void setPhase(Phase value);
void deliver(const NetReply& reply);
void handleReply(const NetReply& reply);

void setPhase(Phase value) { if(phase!=value){phase=value;phaseAt=millis();} }
bool waiting() { return phase==SENDING||phase==WAIT_RESULT; }
void cancelGesture() { armed=false;recording=false;released=false;settled=false; }
bool freshBuddy() { return online&&clockReady&&transportReady&&buddy&&millis()-lastSync<12000; }
void clearRound() {
  revision++;pendingSequence=0;cancelGesture();
  peakG=score=peakGyro=0;strcpy(lastResult,"--");caughtId[0]=0;
}

void ledTask(void*) {
  for(;;){
    Phase current=phase;
    bool on=current==CAUGHT||((current==SENDING||current==WAIT_RESULT)&&(millis()/250)%2==0);
    digitalWrite(RED_LED_PIN,on?LOW:HIGH);
    vTaskDelay(pdMS_TO_TICKS(25));
  }
}

String apiUrl(const char* path) {
  String base(SERVER_URL);int pos=base.indexOf("/api/throw");
  return pos<0?String(""):base.substring(0,pos)+path;
}
void deliver(const NetReply& reply) {
  NetReply current=reply;current.wifi=WiFi.status()==WL_CONNECTED;current.clockReady=time(nullptr)>1700000000;
  xQueueSend(replies,&current,pdMS_TO_TICKS(50));
}

// Only this task performs HTTPS. Buttons, IMU, drawing and LED never wait for it.
void networkTask(void*) {
  unsigned long pending=0,pendingRevision=0,pendingAt=0,lastPoll=0;
  for(;;){
    ThrowJob job;
    if(xQueueReceive(jobs,&job,0)==pdTRUE){
      NetReply r={};r.kind=POST_REPLY;r.revision=job.revision;
      r.wifi=WiFi.status()==WL_CONNECTED;r.clockReady=time(nullptr)>1700000000;
      String url=apiUrl("/api/throw");
      if(!url.length())r.code=-1001;
      if(r.wifi&&r.clockReady&&url.length()){
        WiFiClientSecure client;client.setCACert(PACE_ROOT_CA);client.setHandshakeTimeout(4);
        HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(4000);
        if(http.begin(client,url)){
          const char* headers[]={"X-Throw-Sequence"};http.collectHeaders(headers,1);
          http.addHeader("Authorization",String("Bearer ")+RELAY_TOKEN);
          http.addHeader("Content-Type","application/json");
          String body=String("{\"event\":\"throw\",\"encounter_id\":\"")+job.encounter+
            "\",\"peak_g\":"+String(job.peak,2)+",\"motion_score\":"+String(job.score,3)+
            ",\"duration_ms\":"+String(job.duration)+"}";
          r.code=http.POST(body);
          const long seq=r.code==200?http.header("X-Throw-Sequence").toInt():0;
          r.sequence=seq>0?(unsigned long)seq:0;
          http.end();
        }
      }
      if(r.code==200&&r.sequence){pending=r.sequence;pendingRevision=job.revision;pendingAt=millis();lastPoll=0;}
      deliver(r);
    }
    if(pending&&millis()-pendingAt>RESULT_MS+5000)pending=0;
    const unsigned long now=millis();
    if(now-lastPoll>=(pending?750:1500)){
      lastPoll=now;
      NetReply r={};r.kind=STATUS_REPLY;r.sequence=pending;r.revision=pendingRevision;
      r.wifi=WiFi.status()==WL_CONNECTED;r.clockReady=time(nullptr)>1700000000;
      String base=apiUrl("/api/device?sequence=");
      String url=base.length()?base+String(pending):String("");
      if(!url.length())r.code=-1001;
      if(r.wifi&&r.clockReady&&url.length()){
        WiFiClientSecure client;client.setCACert(PACE_ROOT_CA);client.setHandshakeTimeout(4);
        HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(3000);
        if(http.begin(client,url)){
          const char* keys[]={"X-Encounter-Id","X-Encounter-State","X-Device-Status"};
          http.collectHeaders(keys,3);http.addHeader("Authorization",String("Bearer ")+RELAY_TOKEN);
          r.code=http.GET();
          if(r.code==200){
            String id=http.header("X-Encounter-Id"),value=http.getString();value.trim();
            r.protocol=http.header("X-Device-Status")=="2"&&id.length()<=80;
            r.active=http.header("X-Encounter-State")=="present"&&id.length()>0;
            snprintf(r.encounter,sizeof(r.encounter),"%s",id.c_str());
            snprintf(r.result,sizeof(r.result),"%s",value.c_str());
            if(value=="success"||value=="failure"||value=="stale")pending=0;
          }
          http.end();
        }
      }
      deliver(r);
    }
    vTaskDelay(pdMS_TO_TICKS(15));
  }
}

void handleReply(const NetReply& r) {
  online=r.wifi;clockReady=r.clockReady;lastHttp=r.code;
  if(r.kind==POST_REPLY){
    if(r.revision!=revision||phase!=SENDING)return;
    if(!r.wifi||!r.clockReady||r.code==401)transportReady=false;
    if(r.code==401){pendingSequence=0;setPhase(AUTH_ERROR);return;}
    if(r.code==409){buddy=false;pendingSequence=0;setPhase(IDLE);return;}
    if(r.code==200&&r.sequence){pendingSequence=r.sequence;throws++;lastThrow=millis();setPhase(WAIT_RESULT);}
    else {pendingSequence=0;setPhase(r.code==200||r.code==404?UPDATE_API:SEND_ERROR);}
    return;
  }
  if(!r.wifi||!r.clockReady||r.code!=200||!r.protocol){
    transportReady=false;
    if(r.code==401||r.code==404||(r.code==200&&!r.protocol)){
      if(waiting())revision++;
      pendingSequence=0;cancelGesture();setPhase(r.code==401?AUTH_ERROR:UPDATE_API);return;
    }
    if(!waiting()){cancelGesture();setPhase(r.code==404||r.code==200?UPDATE_API:!r.wifi?OFFLINE:SYNC_ERROR);}
    return;
  }
  lastSync=millis();transportReady=true;
  // ID, not a presence edge, defines a new buddy. Old result replies cannot affect it.
  if(r.active&&strcmp(buddyId,r.encounter)!=0){
    clearRound();snprintf(buddyId,sizeof(buddyId),"%s",r.encounter);buddy=true;setPhase(FOUND);
  }else{
    buddy=r.active&&strcmp(caughtId,r.encounter)!=0;
    if(!buddy){
      if(armed){cancelGesture();setPhase(IDLE);}
      else if(!waiting()&&phase!=CAUGHT&&phase!=RESULT_TIMEOUT)setPhase(IDLE);
    }else if(phase==OFFLINE||phase==SYNC_ERROR||phase==UPDATE_API||phase==IDLE)setPhase(FOUND);
  }
  if(phase==WAIT_RESULT&&r.sequence==pendingSequence&&r.revision==revision){
    if(strcmp(r.result,"success")==0){strcpy(lastResult,"Captured");snprintf(caughtId,sizeof(caughtId),"%s",buddyId);buddy=false;pendingSequence=0;setPhase(CAUGHT);}
    else if(strcmp(r.result,"failure")==0){strcpy(lastResult,"Escaped");pendingSequence=0;setPhase(ESCAPED);}
    else if(strcmp(r.result,"stale")==0){pendingSequence=0;setPhase(SYNC_ERROR);}
  }
}

void completeGesture(unsigned long now) {
  recording=false;armed=false;
  if(!freshBuddy()){setPhase(SYNC_ERROR);return;}
  if(peakG<MIN_PEAK_G||score<MIN_SCORE||strongMs<60||peakGyro<MIN_GYRO){setPhase(WEAK);return;}
  ThrowJob job={};job.revision=revision;job.peak=peakG;job.score=score;job.duration=now-beganAt;
  snprintf(job.encounter,sizeof(job.encounter),"%s",buddyId);
  setPhase(SENDING);
  if(xQueueSend(jobs,&job,0)!=pdTRUE)setPhase(SEND_ERROR);
}

const char* title() {
  switch(phase){
    case OFFLINE:return "WIFI OFFLINE";case IDLE:return "WAIT FOR BUDDY";case FOUND:return "BUDDY APPEARED!";
    case RELEASE_BUTTON:return "RELEASE BUTTON";case SETTLING:return "HOLD STILL";case READY:return "READY: SWING";
    case SWING:return "SWING DETECTED";case SENDING:return "SENDING THROW";case WAIT_RESULT:return "WAIT RESULT";
    case CAUGHT:return "CAPTURE SUCCESS";case ESCAPED:return "CAPTURE FAILED";case WEAK:return "TOO WEAK";
    case ARM_TIMEOUT:return "ARM TIMEOUT";case RESULT_TIMEOUT:return "RESULT TIMEOUT";
    case SEND_ERROR:return "SEND FAILED";case IMU_ERROR:return "IMU ERROR";case UPDATE_API:return "UPDATE CLOUD API";case INIT_ERROR:return "DEVICE INIT ERROR";case AUTH_ERROR:return "WRONG CLOUD KEY";
    default:return "CHECK CONNECTION";
  }
}
const char* hint() {
  if(phase==INIT_ERROR)return "Restart device; task setup failed";
  if(lastHttp==-1001)return "Fix SERVER_URL in cloud_config.h";
  if(!online)return "Connect M5 to your phone hotspot";
  if(!clockReady)return "Waiting for internet time sync";
  if(!transportReady)return lastHttp==401?"Check cloud key in config":"Check phone / cloud connection";
  if(waiting())return "Keep phone capture page open";
  if(phase==CAUGHT)return "Caught! Waiting for next buddy";
  if(phase==RELEASE_BUTTON)return "Release A; then wait for READY";
  if(phase==SETTLING)return "Hold device steady briefly";
  if(phase==READY||phase==SWING)return "Swing while holding the device";
  return buddy?"Tap A to prepare a throw":"Keep PACE connected on your phone";
}
void drawScreen(unsigned long now) {
  // Fixed rows, explicit clear and text clipping prevent leftovers and line wrapping.
  static char previous[160]="";char stamp[160];
  snprintf(stamp,sizeof(stamp),"%d|%d|%d|%d|%d|%d|%lu|%lu|%u|%.1f|%s",(int)phase,online,clockReady,transportReady,buddy,lastHttp,now/1000,revision,throws,peakG,lastResult);
  if(strcmp(stamp,previous)==0)return;snprintf(previous,sizeof(previous),"%s",stamp);
  M5.Lcd.fillScreen(BLACK);M5.Lcd.setTextWrap(false);M5.Lcd.setTextColor(WHITE,BLACK);
  M5.Lcd.setTextSize(1);M5.Lcd.setCursor(5,4);M5.Lcd.print("PACE M5 2.6");
  M5.Lcd.setCursor(151,4);M5.Lcd.printf("WiFi:%s",online?"OK":"OFF");
  M5.Lcd.setTextSize(2);M5.Lcd.setCursor(5,27);M5.Lcd.printf("%.19s",title());
  M5.Lcd.setTextSize(1);M5.Lcd.setCursor(5,55);
  M5.Lcd.printf("Buddy: %s",!transportReady?"unknown":buddy?"Trail companion":"none");
  M5.Lcd.setCursor(5,71);M5.Lcd.printf("%.38s",hint());
  M5.Lcd.setCursor(5,87);
  if(armed){
    const unsigned long age=now-pressedAt,remaining=age<READY_MS?READY_MS-age:0;
    M5.Lcd.printf("Ready window: %lus",(remaining+999)/1000);
  }
  else if(waiting())M5.Lcd.printf("Waiting: %lus / 20s",(now-phaseAt)/1000);
  else M5.Lcd.printf("Throws:%u  Peak:%.2fg",throws,peakG);
  M5.Lcd.setCursor(5,103);
  if(lastSync)M5.Lcd.printf("Sync:%lus ago  HTTP:%d",(now-lastSync)/1000,lastHttp);
  else M5.Lcd.printf("Cloud: not synced  HTTP:%d",lastHttp);
  M5.Lcd.setCursor(5,119);M5.Lcd.printf("Last result: %.20s",lastResult);
}

void setup() {
  M5.begin();Serial.begin(115200);M5.Imu.Init();M5.Lcd.setRotation(3);
  pinMode(RED_LED_PIN,OUTPUT);digitalWrite(RED_LED_PIN,HIGH);
  jobs=xQueueCreate(2,sizeof(ThrowJob));replies=xQueueCreate(12,sizeof(NetReply));
  WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.begin(WIFI_SSID,WIFI_PASS);
  configTime(0,0,"pool.ntp.org","time.google.com");
  TaskHandle_t network=nullptr;
  if(!jobs||!replies||xTaskCreatePinnedToCore(networkTask,"pace-net",12288,nullptr,1,&network,0)!=pdPASS){setPhase(INIT_ERROR);return;}
  if(xTaskCreate(ledTask,"pace-led",2048,nullptr,1,nullptr)!=pdPASS){vTaskDelete(network);setPhase(INIT_ERROR);return;}
  deviceReady=true;
}
void loop() {
  M5.update();unsigned long now=millis();NetReply reply;
  if(!deviceReady){drawScreen(now);delay(100);return;}
  if(replies)while(xQueueReceive(replies,&reply,0)==pdTRUE)handleReply(reply);
  now=millis();
  if(waiting()&&now-phaseAt>=RESULT_MS){revision++;pendingSequence=0;setPhase(RESULT_TIMEOUT);}
  if(transportReady&&now-lastSync>=12000){transportReady=false;cancelGesture();if(!waiting())setPhase(SYNC_ERROR);}
  bool down=M5.BtnA.isPressed();
  if(down&&!previousDown&&!armed&&!waiting()&&jobs&&freshBuddy()&&phase!=CAUGHT&&now-lastThrow>=1000){
    cancelGesture();pressedAt=now;armed=true;peakG=score=peakGyro=0;stillMs=strongMs=quietMs=0;
    strcpy(lastResult,"--");setPhase(RELEASE_BUTTON);
  }
  if(!down&&previousDown&&armed&&!released){released=true;pressedAt=now;setPhase(SETTLING);}
  previousDown=down;
  if(armed&&now-pressedAt>=READY_MS){cancelGesture();setPhase(ARM_TIMEOUT);}
  if(armed&&now-lastSample>=SAMPLE_MS){
    unsigned long dt=lastSample?now-lastSample:SAMPLE_MS;lastSample=now;
    float x=0,y=0,z=0,gx=0,gy=0,gz=0;
    M5.Imu.getAccelData(&x,&y,&z);M5.Imu.getGyroData(&gx,&gy,&gz);
    float a=sqrtf(x*x+y*y+z*z),g=sqrtf(gx*gx+gy*gy+gz*gz);
    if(!isfinite(a)||a<.01f||!isfinite(g)){cancelGesture();setPhase(IMU_ERROR);}
    else if(dt>80&&recording){cancelGesture();setPhase(IMU_ERROR);}
    else if(released&&now-pressedAt>=ARM_MS){
      dt=dt>40?20:dt;float delta=fabsf(a-1);
      if(!settled){stillMs=(delta<.2f&&g<45)?stillMs+dt:0;if(stillMs>=120){settled=true;setPhase(READY);}}
      else{
        if(!recording&&delta>=START_DELTA_G&&g>=180){recording=true;beganAt=now;peakG=score=peakGyro=0;strongMs=quietMs=0;setPhase(SWING);}
        if(recording){
          peakG=fmaxf(peakG,a);peakGyro=fmaxf(peakGyro,g);score+=fmaxf(0,delta-.55f)*dt/1000;
          if(delta>=.9f&&g>=MIN_GYRO)strongMs+=dt;
          quietMs=delta<.3f&&g<100?quietMs+dt:0;
          if(quietMs>=80||now-beganAt>=500)completeGesture(now);
        }
      }
    }
  }
  if(now-lastDraw>=100){lastDraw=now;drawScreen(millis());}
  delay(2);
}
