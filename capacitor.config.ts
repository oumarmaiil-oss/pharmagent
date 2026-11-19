// Configuration prête pour l'empaquetage natif Android (Google Play) & iOS (App Store) via Capacitor
// Exécuter localement après export :
//   npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
//   npm run build && npx cap sync
const config = {
  appId: 'sn.pharmagent.app',
  appName: 'PharmAgent',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  backgroundColor: '#020617',
};

export default config;
