export const environment = {
  production: false,
  // Point Firebase Auth + Firestore at local emulators (ng serve -c emulator).
  useEmulators: false,
  emailjs: {
    serviceId: 'service_zqvufsd',
    templateId: 'template_tgz7wpc',
    publicKey: 'bSh8TdsI1w2FO6ySF'
  },
  // The client secret now lives only in the Cloud Function (functions/index.js);
  // the browser talks to Splitwise through the same-origin proxy at proxyBaseUrl.
  // Only the public clientId + redirectUri are needed here (for the authorize
  // redirect). See DEPLOYMENT.md for the deploy + secret steps.
  splitwise: {
    clientId: 'ArJ0dxQTlRhtq3dqp5T0G7eGXvcCzas2i2KNrat5',
    redirectUri: 'https://two-cents-budget-tracker.web.app/#/splitwise/callback',
    proxyBaseUrl: '/api/splitwise'
  },
  firebase: {
    apiKey: 'AIzaSyD_hm7vbZi2dbi7kokObTcydl6cIm85O-Y',
    authDomain: 'two-cents-budget-tracker.firebaseapp.com',
    projectId: 'two-cents-budget-tracker',
    storageBucket: 'two-cents-budget-tracker.firebasestorage.app',
    messagingSenderId: '512934378263',
    appId: '1:512934378263:web:5bb17814cf616013875552',
    measurementId: 'G-GYC64CRCD4'
  }
};
