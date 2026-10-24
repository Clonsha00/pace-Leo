#include <M5StickCPlus.h>
#include <math.h>

// M5StickC Plus (not Plus2). Thresholds are initial test values,
// not a measurement of throwing speed or capture quality.
constexpr float TRIGGER_G = 1.8f;
constexpr unsigned long ARM_MS = 300;
constexpr unsigned long COOLDOWN_MS = 800;
constexpr unsigned long SAMPLE_MS = 20;
unsigned long pressedAt = 0, lastThrow = 0, lastSample = 0, lastDraw = 0;
unsigned int throws = 0;
int highSamples = 0;
bool held = false, used = false, hasThrown = false;
bool valid = false;
float magnitude = 0;

void setup() {
  M5.begin();
  Serial.begin(115200);
  M5.Imu.Init();
  M5.Lcd.setRotation(3);
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setTextColor(WHITE, BLACK);
  Serial.println("PACE throw test v1 - hold A, swing, release");
}

void loop() {
  M5.update();
  const unsigned long now = millis();
  const bool down = M5.BtnA.isPressed();
  if (down && !held) {
    pressedAt = now;
    highSamples = 0;
  }
  if (!down) {
    used = false;
    highSamples = 0;
  }
  held = down;
  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    float x = 0, y = 0, z = 0;
    M5.Imu.getAccelData(&x, &y, &z);
    magnitude = sqrtf(x*x + y*y + z*z);
    valid = isfinite(magnitude) && magnitude > 0.01f;
    const bool ready = held && !used && now - pressedAt >= ARM_MS
      && (!hasThrown || now - lastThrow >= COOLDOWN_MS);
    if (ready && valid && magnitude >= TRIGGER_G) highSamples++;
    else highSamples = 0;
    // Three consecutive samples reduce single-sample noise.
    if (highSamples >= 3) {
      throws++;
      used = true;
      hasThrown = true;
      lastThrow = now;
      highSamples = 0;
      Serial.printf("{\"event\":\"throw\",\"sequence\":%u,\"accel_g\":%.2f}\n", throws, magnitude);
    }
  }
  if (now - lastDraw >= 100) {
    lastDraw = now;
    M5.Lcd.setTextSize(2);
    M5.Lcd.setCursor(4, 4);
    M5.Lcd.print("PACE THROW TEST");
    M5.Lcd.setCursor(4, 32);
    const char* state = !valid ? "CHECK IMU" : used ? "THROW! Release A" :
      !held ? "Hold A to arm" : now - pressedAt < ARM_MS ? "Preparing..." :
      hasThrown && now - lastThrow < COOLDOWN_MS ? "Cooldown..." : "READY: swing";
    M5.Lcd.printf("%-19s", state);
    M5.Lcd.setCursor(4, 60);
    M5.Lcd.printf("Throws: %-8u", throws);
    M5.Lcd.setCursor(4, 86);
    M5.Lcd.printf("Accel: %5.2f g  ", magnitude);
    M5.Lcd.setTextSize(1);
    M5.Lcd.setCursor(4, 116);
    M5.Lcd.print("Keep holding device. No phone link.");
  }
  delay(2);
}
