# BoxPlay — Cricket Box Booking Demo

Responsive front-end prototype for a cricket box booking website.

## Features
- Search sample grounds by city/area/name and sort by hourly price.
- View demo time slots and submit a booking request.
- Demo owner sign-in, add up to two grounds per browser owner profile, and view booking requests.
- Mobile responsive layout.

## Run locally on Windows PowerShell

Install Git for Windows and Python 3 if they are not already installed. Open PowerShell and run:

```powershell
git clone https://github.com/tusharjotva44/cricket-box-booking-india.git
cd cricket-box-booking-india
py -m http.server 5500
```

Then open **http://localhost:5500** in your browser. Keep the PowerShell window open while testing. Stop the local server with **Ctrl+C**.

If you already downloaded/cloned this repository, run `cd` into that project folder and run `py -m http.server 5500`.

## Important prototype notes
- The listings are sample data, not verified real grounds.
- Bookings and added grounds are saved in the browser's localStorage on that device/browser only.
- The owner login is a demo, not secure authentication.
- There is no real payment, SMS/WhatsApp notification, shared database, or live availability across devices yet. Do not use this prototype to collect real customer data or payments.
- Google Fonts and sample photos load from external URLs and need internet access.

## Suggested next production stage
Connect a backend/database, secure owner authentication, real slot locking, payment verification, and notifications before public launch.
