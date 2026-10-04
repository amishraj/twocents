# Local emulator testing

Run the app against local Firebase emulators (no real Firebase project is touched):

```bash
npx firebase emulators:start --only auth,firestore --project two-cents-budget-tracker
```

```bash
npm start -- --configuration emulator --port 4291
```

The `emulator` build configuration swaps in `src/environments/environment.emulator.ts`, which sets
`useEmulators: true` so `FirebaseClientService` connects Auth to `127.0.0.1:9099` and Firestore to
`127.0.0.1:8080`. Emulator data is in-memory and discarded on restart.

## Throwaway test account (emulator only)

These credentials exist only in the local Auth emulator and are safe to share:

- email: `tester@twocents.local`
- password: `tester-pass-123`
- second member (for household flows): `partner@twocents.local` / `partner-pass-123`
