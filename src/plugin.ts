import streamDeck from "@elgato/streamdeck";

import { PresetTimerAction } from "./actions/preset-timer";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new PresetTimerAction());

streamDeck
	.connect()
	.then(() => streamDeck.logger.info("Neo Pomodoro plugin connected"))
	.catch((err: unknown) => streamDeck.logger.error("Failed to connect to Stream Deck", err));
