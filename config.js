// Fill these in to connect the planner to your Google Sheet (see README.md, steps 2–4).
// Leave them empty to use try-it mode, which saves on this device only.
//
// Neither value is a secret: the client ID only identifies this app to Google, and the
// sheet can only be opened by the Google accounts you've shared it with.
export const CONFIG = {
  // From Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
  // Looks like: 1234567890-abc123def456.apps.googleusercontent.com
  googleClientId: "",

  // The long ID in your sheet's address: docs.google.com/spreadsheets/d/<THIS PART>/edit
  spreadsheetId: "1ivetFoFLeoiNkCdHsknPtq14sq14DvbUItg5o2weG98",

  // Optional: a link to your family agreement, shown on the Check-in tab.
  dealUrl: "https://docs.google.com/document/d/1EG2bUTj3BZpqE4QVPLE7p9XCp7m0pbiVt8PRmXaoBaY/edit",

  // How often (in seconds) the app checks the sheet for changes made on another phone or in the sheet itself.
  pollSeconds: 20,
};
