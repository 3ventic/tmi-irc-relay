var config = {};

config.address = "irc.chat.twitch.tv"; // Twitch's IRC address
config.tmiPort = 6667; // Twitch's IRC port
config.relayPort = 6667; // Port the relay listens to

config.sendChannelModeNotices = true; // Send a human-readable notice with slow/sub-modes

config.apiClientId = ""; // Because Twitch API likes Client-ID header to be included with API requests

config.viewerListUpdateInterval = 60; // Update the viewer list every 30 seconds by default

config.viwerListUpdateEnabled = true; // Might want to disable entirely in some cases

config.stripTags = true; // Strip tags from the message sent to the client

/**
 * +o is always set, do not include it below
 * Admins have a, subscribers h, turbo v
 */
config.staffMode = "q"; // Twitch staff's additional modes
config.broadcasterMode = ""; // Broadcaster's additional modes

module.exports = config;
