import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.recetuliscosmicas.app",
  appName: "Recetulis Cósmicas",
  webDir: "dist",
  server: { androidScheme: "https" },
  plugins: {
    App: { disableBackButtonHandler: false },
    CapacitorHttp: { enabled: true },
    FirebaseAuthentication: { skipNativeAuth: false, providers: ["google.com"] },
  },
};

export default config;
