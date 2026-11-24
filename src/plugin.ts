import streamDeck from "@elgato/streamdeck";

import { BreakTimerAction, PresetTimerAction, TimerKeys } from "./actions/timer-actions";
import { defaultStatePath, fileStorage, StateStore } from "./persistence/store";

streamDeck.logger.setLevel("info");

/**
 * Loads the saved timer state before registering the actions, so the first key events already see the
 * restored session; then catches up once connected (alert settings are read over the connection).
 */
async function main(): Promise<void> {
	const store = await StateStore.open(fileStorage(defaultStatePath()), streamDeck.logger);
	const timer = new TimerKeys(store);
	streamDeck.actions.registerAction(new PresetTimerAction(timer));
	streamDeck.actions.registerAction(new BreakTimerAction(timer));
	await streamDeck.connect();
	streamDeck.logger.info("Focus Keys plugin connected");
	timer.recover();
}

main().catch((err: unknown) => streamDeck.logger.error("Focus Keys plugin failed to start", err));
