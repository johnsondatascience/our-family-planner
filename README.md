# Our Family Planner

A small web app for planning the family week together: meals, school dropoff and pickup, activities, homework, bedtime, groceries, the kids' jobs and stars, the daily rhythm, snack ideas and Sunday check-ins.

It runs on **GitHub Pages** (free static hosting) and keeps all its data in a **Google Sheet** in your Drive: **Our Family Planner Data**. There is no server. Each phone signs in with Google and reads and writes the sheet directly, so only people you've shared the sheet with can see or change anything. You can also open the sheet and edit it by hand, and those edits show up in the app within about 20 seconds.

Until you finish setup, the app runs in **try-it mode**: it works fully but saves only in the browser you're using.

---

## Setup (about 15 minutes, once)

### 1. Put the app on GitHub Pages

The code lives in `johnsondatascience/our-family-planner`.

1. In the repository, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and click **Save**.
2. After a minute, the site is live at <https://johnsondatascience.github.io/our-family-planner/>. Open it and you'll see the planner in try-it mode.

> On a free GitHub account, a Pages site needs a public repository. That's fine here: the repository holds only the app's code. Your family's data lives in the Google Sheet, which only the accounts you share it with can open. `config.js` contains the sheet's ID and a link to your Family Deal doc, and neither opens without access. If you'd rather not publish the Deal link, clear `dealUrl` in `config.js`.

### 2. Create a Google Cloud project and turn on the Sheets API

1. Go to <https://console.cloud.google.com/> and sign in with the Google account that owns the sheet.
2. Create a project (top bar → project picker → **New project**), and name it `Family Planner`.
3. Open **APIs & Services → Library**, search for **Google Sheets API**, and click **Enable**.

### 3. Set up Google sign-in

1. Open **Google Auth Platform** (older consoles call it **APIs & Services → OAuth consent screen**) and click **Get started**.
2. Enter the app name `Our Family Planner` and your email as the support email. For **Audience**, choose **External**. Finish the wizard.
3. Go to **Audience → Test users** and add **your Gmail address and Shayla's**. Leave the app in **Testing** mode. It then needs no review by Google, and only the test users can sign in.
4. Go to **Clients → Create client** (older consoles: **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `https://johnsondatascience.github.io` (no path and no trailing slash). To test on your computer too, also add `http://localhost:8000`.
   - Leave redirect URIs empty and click **Create**.
5. Copy the **Client ID**. It looks like `1234567890-abc123.apps.googleusercontent.com`.

### 4. Connect the app

1. Open `config.js` in your repository (click the pencil icon to edit it on GitHub) and paste the Client ID:
   ```js
   googleClientId: "1234567890-abc123.apps.googleusercontent.com",
   ```
   `spreadsheetId` already points to **Our Family Planner Data**.
2. Commit the change. Pages redeploys within a minute.

### 5. Share the sheet with Shayla

In Google Drive, open **Our Family Planner Data** → **Share**, add Shayla's Google account, and make her an **Editor**.

### 6. Sign in on each phone

1. Open the site and tap **Sign in with Google**.
2. While the app is in Testing mode, Google shows "Google hasn't verified this app". Tap **Continue**. It's your own app.
3. Allow access to your spreadsheets. The app opens only the planner sheet.
4. Add it to the home screen. On iPhone, open it in Safari, tap **Share**, then **Add to Home Screen**. On Android, open the Chrome menu and tap **Install app**.

---

## Editing the sheet by hand

Each tab is a simple table: one row per item, with headers in row 1.

| Tab | One row per… |
|---|---|
| **Week** | day: breakfast, lunch, dropoff, pickup, activities, homework, dinner, cook, clean-up, bedtime… |
| **Groceries** | item on the list |
| **Stars** | kid, job and week, with a column for each day (2 = without being asked, 1 = after a reminder) |
| **Checkins** | Sunday check-in turn |
| **Rhythm** / **Rules** | step in the school-day routine / rule |
| **Snacks** | snack idea (★ in a kid's column = their pick) |
| **Jobs** / **Rewards** | kids' job (with each kid's level) / reward on the menu |
| **People** | family member. Rename someone here and the app follows. |
| **Settings** | who does the main shop, and when |

- Write people **by name**, exactly as on the People tab. `Everyone` also works.
- Keep the column order. You can reword the header text.
- Leave the `id` column blank on rows you add. The app fills it in.
- Dates can be `2026-10-05` or `10/5/2026`. Write rhythm times in 24-hour form (`15:30`).

If a tab is ever deleted, the app recreates it with its headers and some starter rows the next time it opens.

## Good to know

- **Syncing:** the app checks the sheet every 20 seconds and whenever you switch back to it. If you and Shayla change the *same* field within those seconds, the later change wins.
- **Google sign-in lasts an hour.** The app renews it quietly the next time you tap something. If it lapses, a **Reconnect** button appears, and any changes you made meanwhile wait and then save.
- **iPhone home-screen app:** if the Google sign-in window misbehaves there, sign in once in Safari, then reopen from the home screen.
- **Privacy:** the page runs entirely in your browser and talks only to Google. Your sign-in stays in that browser for at most an hour at a time.

## Running it on your computer

```sh
cd our-family-planner
python3 -m http.server 8000
```

Then open <http://localhost:8000>. For Google sign-in to work there, add `http://localhost:8000` as an authorized JavaScript origin (step 3.4).

## Files

| File | What it does |
|---|---|
| `index.html`, `styles.css` | The page and its look |
| `app.js` | The planner: views, editing, and turning changes into sheet rows |
| `sheets.js` | Google sign-in and the Google Sheets API |
| `local.js` | Try-it mode storage (this browser only) |
| `schema.js` | The sheet's tabs and column order, plus starter rows |
| `config.js` | Your Client ID, sheet ID and Deal link |
| `manifest.webmanifest`, `icons/` | Home-screen app name and icons |
