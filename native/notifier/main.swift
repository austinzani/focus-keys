// Focus Keys notifier: shows one silent macOS notification attributed to "Focus Keys", then exits.
// Bundled inside the plugin as notifier/Focus Keys.app (no window, no Dock icon). The plugin launches it
// through Launch Services, so macOS treats it as an app with its own notification settings:
//   open -n -g "Focus Keys.app" --args --title <title> --body <body> --result <file>
// It writes one line to <file> when done: "ok" (handed to macOS), "denied" (the user turned Focus Keys
// notifications off) or "error: <reason>". The plugin falls back to AppleScript on "error", never on
// "denied". No sound: the plugin plays its own.
import Foundation
import UserNotifications

func argument(_ name: String) -> String? {
	let args = CommandLine.arguments
	guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
	return args[i + 1]
}

let resultPath = argument("--result")

/// Reports the outcome (atomically, so the plugin never reads half a line) and exits.
func finish(_ result: String) -> Never {
	if let path = resultPath {
		try? (result + "\n").write(toFile: path, atomically: true, encoding: .utf8)
	} else {
		FileHandle.standardError.write(Data((result + "\n").utf8))
	}
	exit(result == "ok" ? 0 : 1)
}

guard let title = argument("--title"), let body = argument("--body") else {
	finish("error: usage: --title <title> --body <body> [--result <file>]")
}

/// Shows the banner even if macOS considers this app frontmost.
final class Delegate: NSObject, UNUserNotificationCenterDelegate {
	func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
	                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
		completionHandler([.banner, .list])
	}
}

let center = UNUserNotificationCenter.current()
let delegate = Delegate()
center.delegate = delegate

// The first run waits for the user to answer macOS's permission prompt; give up after two minutes.
DispatchQueue.main.asyncAfter(deadline: .now() + 120) { finish("error: timed out waiting for macOS") }

center.requestAuthorization(options: [.alert]) { granted, error in
	if let error = error { finish("error: authorization failed: \(error.localizedDescription)") }
	guard granted else { finish("denied") }
	let content = UNMutableNotificationContent()
	content.title = title
	content.body = body
	let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
	center.add(request) { error in
		if let error = error { finish("error: could not show the notification: \(error.localizedDescription)") }
		// Give the notification server a moment to take it before this process goes away.
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { finish("ok") }
	}
}

RunLoop.main.run()
