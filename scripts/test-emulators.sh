#!/usr/bin/env bash
# Starts the Firebase emulators for end-to-end tests, first stopping leftovers from an
# interrupted run (a stray database emulator would otherwise block the ports).
pkill -f 'cloud-firestore-emulator' 2>/dev/null
pkill -f 'firebase-tools/lib/bin/firebase.js emulators' 2>/dev/null
pkill -f 'bin/firebase emulators' 2>/dev/null
sleep 1
exec npx firebase emulators:start --only firestore,auth --project demo-siwu
