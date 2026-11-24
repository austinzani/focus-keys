import streamDeck from "@elgato/streamdeck";

import { PresetTimerAction } from "./actions/preset-timer";
import { defaultStatePath, fileStorage, StateStore } from "./persistence/store";

streamDeck.logger.setLevel("info");

/**
 * Loads the saved timer state before registering the action, so the first key events already see the
 * restored session; then catches up once connected (alert settings are read over the connection).
 */
async function main(): Promise<void> {
	const store = await StateStore.open(fileStorage(defaultStatePath()), streamDeck.logger);
	const timer = new PresetTimerAction(store);
	streamDeck.actions.registerAction(timer);
	await streamDeck.connect();
	streamDeck.logger.info("Neo Pomodoro plugin connected");
	timer.recover();
}

main().catch((err: unknown) => streamDeck.logger.error("Neo Pomodoro plugin failed to start", err));
