import path from "node:path";
import { app } from "electron";

if (process.env["VITE_DEV_SERVER_URL"]) {
	const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
} else if (process.env.RECORDLY_USER_DATA_DIR) {
	// Headless exports (scripts/headless-export.mjs) run beside the installed app, so they
	// need their own Chromium profile and settings instead of sharing its locked one.
	const userDataPath = path.resolve(process.env.RECORDLY_USER_DATA_DIR);
	app.setPath("userData", userDataPath);
	app.setPath("sessionData", path.join(userDataPath, "session"));
}

export const USER_DATA_PATH = app.getPath("userData");
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, "recordings");
