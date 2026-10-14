#!/bin/sh
# Double-click to start CronCal. Keep the window that opens: closing it stops CronCal.
cd "$(dirname "$0")" || exit 1
npm start
