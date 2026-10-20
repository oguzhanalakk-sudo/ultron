# Android Counter sample

Minimal Android app in Java and XML. The button increments an accessible counter label. The sample has a JUnit unit test and uses Gradle Wrapper 8.13 with Android Gradle Plugin 8.13.2.

- Debug APK: `gradlew.bat assembleDebug`
- JVM unit tests: `gradlew.bat testDebugUnitTest`
- Release APK: `gradlew.bat assembleRelease` (signing configuration may be required to install it)
- App Bundle: `gradlew.bat bundleRelease`

The first build downloads Gradle and Maven dependencies.
