var config = require("./config");

var net = require('net');
var Message = require("irc-message").parseMessage;
var IRCMessage = require("irc-message").IRCMessage;
var lstream = require("lstream");
var request = require("request");
var messageTools = new IRCMessage();

var server = net.createServer(function (socket)
{
    socket.messageStream = new lstream;
    socket.outgoingMessageStream = new lstream;
    
    socket.channels = {};
    
    socket.irc = new net.Socket();
    socket.irc.connect(config.tmiPort, config.address);
    socket.irc.pipe(socket.messageStream);
    
    socket.messageStream.on('data', function (data)
    {
        parseIncoming(socket, data);
    });
    
    socket.on('close', function ()
    {
        Object.keys(socket.channels).forEach(function (channel)
        {
            clearInterval(socket.channels[channel].timer);
        });
        socket.irc.destroy();
        socket.destroy();
        delete socket;
    });
    socket.on('error', function (e)
    {
        console.log('socket error', e);
    });
    socket.irc.on('error', function (e)
    {
        console.log('socket.irc error', e);
    });
    socket.irc.on('close', function ()
    {
        socket.end();
    });
    
    socket.outgoingMessageStream.on('data', function (data)
    {
        parseOutgoing(socket, data);
    });
    
    socket.pipe(socket.outgoingMessageStream);
});

function parseIncoming(socket, data)
{
    var message = Message(data);
    
    // Nonsense?
    if (!message)
    {
        console.log('no msg', data);
        return;
    }

	console.log("IN", message);
    
    switch (message.command)
    {
        case "PART":
            if (message.prefix.split('!')[0] !== socket.nick)
            {
                return;
            }
            break;
        case "JOIN":
            //if (!socket.channels[channel])
                //parseOutgoing(socket, "JOIN " + message.params[0]);
            return;
        case "315": // WHO
        case "353": // NAMES
        case "366": // End of NAMES
        case "MODE":
        case "GLOBALUSERSTATE":
            return;
        case "HOSTTARGET":
            var channel = message.params[0];
            var params = message.params[1].split(' ');
            socket.write(':Twitch NOTICE ' + channel + ' :Now hosting ' + params[0] + ' with ' + params[1] + ' viewers\r\n');
            return;
        case "CLEARCHAT":
            var channel = message.params[0];
            if (message.params.length > 1)
            {
                var details = "";
                if ('ban-duration' in message.tags) {
                    details += "timed out for " + message.tags['ban-duration'] + " seconds"
                }
                else {
                    details += "banned"
                }
                if ('ban-reason' in message.tags && message.tags['ban-reason'].length > 0) {
                    details += " for \"" + unescapeTag(message.tags['ban-reason']) + "\""
                }
                socket.write(':Twitch NOTICE ' + channel + ' :' + message.params[1].split(' ')[0] + ' has been ' + details + '\r\n');
            }
            else
            {
                socket.write(':Twitch NOTICE ' + channel + ' :Chat was cleared by a moderator!\r\n');
            }
            return;
        case "USERSTATE":
            var channel = message.params[0];
            if (!socket.channels[channel]) return; // unjoined channel, don't care
            if (!socket.channels[channel].joinSent)
            {
                socket.write(':' + socket.nick + '.tmi.twitch.tv 353 ' + socket.nick + ' = ' + channel + ' :' + socket.nick + '\r\n');
                socket.write(':' + socket.nick + '.tmi.twitch.tv 366 ' + socket.nick + ' ' + channel + ' :End of /NAMES list\r\n');
                socket.channels[channel].joinSent = true;
                socket.channels[channel].users[socket.nick] = "";
            }
            if (message.tags)
            {
                parseAndSendUserModes(socket, message, socket.nick);
            }
            return;
        case "PRIVMSG":
            if (message.prefix === 'jtv!jtv@jtv.tmi.twitch.tv' || message.prefix === 'jtv')
            {
                var channel = message.params[0];
                var jtvData = message.params[1].split(' ');
                
                if (channel === socket.nick || !socket.channels[channel]) return;
                
                var subscribers = /^This room is (now|no longer) in subscribers-only mode\.$/.test(message.params[1]);
                
                var slowMode = /^This room is (now|no longer) in slow mode\./.test(message.params[1]);
                
                if (subscribers)
                {
                    if (message.params[1].indexOf('now') !== -1)
                    {
                        socket.write(':Twitch MODE ' + channel + ' +m\r\n');
                        if (config.sendChannelModeNotices) socket.write(':Twitch NOTICE ' + channel + ' :This channel is now in subscribers-only mode.\r\n');
                    } else
                    {
                        socket.write(':Twitch MODE ' + channel + ' -m\r\n');
                        if (config.sendChannelModeNotices) socket.write(':Twitch NOTICE ' + channel + ' :This channel is no longer in subscribers-only mode.\r\n');
                    }
                }
                else if (slowMode)
                {
                    if (message.params[1].indexOf('now') !== -1)
                    {
                        var slowTime = /You may send messages every ([0-9]+) seconds/.exec(message.params[1]);
                        socket.write(':Twitch MODE ' + channel + ' +f ' + slowTime[1].trim() + 's\r\n');
                        if (config.sendChannelModeNotices) socket.write(':Twitch NOTICE ' + channel + ' :Slow mode activated at ' + slowTime[1].trim() + ' seconds\r\n');
                    } else
                    {
                        socket.write(':Twitch MODE ' + channel + ' -f\r\n');
                        if (config.sendChannelModeNotices) socket.write(':Twitch NOTICE ' + channel + ' :Slow mode deactivated\r\n');
                    }
                }
                else if (jtvData[0].match(/(?:Now|USERCOLOR|EMOTESET|SPECIALUSER|CLEARCHAT|HISTORYEND)/))
                {
                    return;
                }
                else
                {
                    var params = '';
                    var length = message.params.length;
                    for (var i = 1; i < length; i++)
                    {
                        params += ' ' + message.params[i];
                    }
                    params = params.trim();
                    sendInParts(socket, ':Twitch NOTICE ' + channel + ' :' + params + '\r\n');
                }
                return;
            }
            else if (message.prefix === 'twitchnotify!twitchnotify@twitchnotify.tmi.twitch.tv' || message.prefix === 'twitchnotify')
            {
                socket.write(':twitchnotify!twitchnotify@twitchnotify.tmi.twitch.tv NOTICE ' + message.params[0] + ' :' + message.params[1] + '\r\n');
                return;
            }
            
            if (message.tags)
            {
                var user = message.prefix.split('!')[0];
                var channel = message.params[0];
                if (typeof socket.channels[channel] !== "object")
                {
                    
                }
                else if (typeof socket.channels[channel].users[user] !== "string")
                {
                    socket.channels[channel].users[user] = "";
                    socket.write(':' + user + '!' + user + '@' + user + '.tmi.twitch.tv JOIN ' + channel + '\r\n');
                }
                parseAndSendUserModes(socket, message, user);
            }
            break;
    }
    
    sendInParts(socket, data);
    
    // Send 005 in the correct position
    if (data.indexOf(":tmi.twitch.tv 004") == 0)
        socket.write(':tmi.twitch.tv 005 ' + socket.nick + ' PREFIX=(qaohv)~&@%+ CHANTYPES=# CHANMODES=b,f,,m NETWORK=Twitch :are supported by this server\r\n');
}

function parseOutgoing(socket, data)
{
    var message = Message(data);
	console.log("OUT", message);
    
    if (message.command === 'NICK')
    {
        socket.nick = message.params[0].trim();
        socket.irc.write('CAP REQ :twitch.tv/tags twitch.tv/commands' + '\r\n');
    }

    else if (message.command === 'JOIN')
    {
        message.params[0].split(',').forEach(function (channel)
        {
			console.log("sending join for", channel);
            socket.write(':' + socket.nick + '!' + socket.nick + '@' + socket.nick + '.tmi.twitch.tv JOIN ' + channel + '\r\n');
            if (!socket.channels[channel])
            {
                socket.channels[channel] = {
                    joinSent: false,
                    users: {},
                    myModes: [],
                    topic: 'Welcome to the channel!',
                    timer: setInterval(function ()
                    {
                        if (socket.channels[channel])
                        {
                            socket.channels[channel].update();
                        }
                    }, config.viewerListUpdateInterval * 1000),
                    update: function ()
                    {
                        request.get({
                            url: 'https://api.twitch.tv/kraken/channels/' + channel.replace('#', ''),
                            json: true,
                            timeout: 14000,
                            headers: {
                                'Client-ID': config.apiClientId
                            }
                        }, function (err, res, data)
                        {
                            if (err)
                            {
                                console.log(err);
                                return;
                            }
                            // Check the channel wasn't parted during the request, which can take a long time
                            if (!(channel in socket.channels))
                            {
                                return;
                            }
                            if (data && data.status && socket.channels[channel].topic !== data.status)
                            {
                                socket.channels[channel].topic = data.status;
                                socket.write(':Twitch TOPIC ' + channel + ' :' + data.status + '\r\n');
                            }
                        });
                        if (config.viwerListUpdateEnabled)
                        {
                            request.get({
                                url: 'https://tmi.twitch.tv/group/user/' + channel.replace('#', '') + '/chatters',
                                json: true,
                                timeout: 14000,
                                headers: {
                                    'Client-ID': config.apiClientId
                                }
                            }, function (err, res, data)
                            {
                                if (err || !data)
                                {
                                    console.log(err, data, res.statusCode);
                                    return;
                                }
                                // Check the channel wasn't parted during the request, which can take a long time
                                if (!(channel in socket.channels))
                                {
                                    return;
                                }
                                var userList = socket.channels[channel].users;
                                
                                if (data.chatters)
                                {
                                    var currentUsers = Object.keys(userList);
                                    var newUsers = [];
                                    
                                    var chatterTypes = Object.keys(data.chatters);
                                    for (var i = 0; i < chatterTypes.length; i++)
                                    {
                                        newUsers = newUsers.concat(data.chatters[chatterTypes[i]]);
                                    }
                                    
                                    if (newUsers.indexOf(socket.nick) === -1)
                                        newUsers.push(socket.nick);
    
                                    var joins = [];
                                    var parts = [];
                                    var modes = [];
                                    
                                    currentUsers.forEach(function (user)
                                    {
                                        if (newUsers.indexOf(user) === -1)
                                        {
                                            delete userList[user];
                                            parts.push(user);
                                        }
                                    });
                                    
                                    if (typeof userList[socket.nick] !== "string")
                                        userList[socket.nick] = "";
                                    
                                    for (var i = 0; i < chatterTypes.length; i++)
                                    {
                                        data.chatters[chatterTypes[i]].forEach(function (user)
                                        {
                                            if (user === socket.nick)
                                            {
                                                // don't handle yourself, causes duplicate JOINs and we already have our own MODEs from USERSTATE
                                                return;
                                            }
                                            if (typeof userList[user] !== "string")
                                            {
                                                userList[user] = "";
                                                joins.push(user);
                                            }
                                            
                                            var _modes = "";
                                            var removeModes = "";
                                            
                                            if (channel.replace('#', '') === user && userList[user].indexOf(config.broadcasterMode) === -1)
                                            {
                                                _modes += config.broadcasterMode + 'o';
                                            }
                                            if (chatterTypes[i] === 'staff' && userList[user].indexOf(config.staffMode) === -1)
                                            {
                                                _modes += _modes.indexOf('o') === -1 ? config.staffMode + 'o' : config.staffMode;
                                            }
                                            else if ((chatterTypes[i] === 'admins' || chatterTypes[i] === 'global_mods') && userList[user].indexOf('a') === -1)
                                            {
                                                _modes += 'ao';
                                            }
                                            else if (chatterTypes[i] === 'moderators' && userList[user].indexOf('o') === -1)
                                            {
                                                _modes += 'o';
                                            }
                                            else if (chatterTypes[i] === 'viewers' && data.chatters['moderators'].length > 0)
                                            {
                                                for (var j = 0; j < userList[user].length; ++j)
                                                {
                                                    if (userList[user][j] === 'h')
                                                    {
                                                        _modes += 'h';
                                                        continue;
                                                    }
                                                    if (userList[user][j] === 'v')
                                                    {
                                                        _modes += 'v';
                                                        continue;
                                                    }
                                                    removeModes += userList[user][j];
                                                }
                                            }
                                            
                                            var names = [];
                                            var updated = false;
                                            if (removeModes.length > 0)
                                            {
                                                updated = true;
                                                for (var j = 0; j < removeModes.length; ++j)
                                                {
                                                    names.push(user);
                                                }
                                                modes.push('-' + removeModes + ' ' + names.join(' '));
                                            }
                                            if (userList[user] !== _modes && _modes.length > 0)
                                            {
                                                updated = true;
                                                names = [];
                                                for (var j = 0; j < _modes.length; ++j)
                                                {
                                                    names.push(user);
                                                }
                                                modes.push('+' + _modes + ' ' + names.join(' '));
                                            }
                                            
                                            if (updated)
                                                userList[user] = _modes;
                                        });
                                    }
                                    
                                    if (joins.length < 100)
                                    {
                                        while (joins.length)
                                        {
                                            var user = joins.splice(0, 1).toString();
                                            socket.write(':' + user + '!' + user + '@' + user + '.tmi.twitch.tv JOIN ' + channel + '\r\n');
                                        }
                                        while (parts.length)
                                        {
                                            var user = parts.splice(0, 1).toString();
                                            socket.write(':' + user + '!' + user + '@' + user + '.tmi.twitch.tv PART ' + channel + '\r\n');
                                        }
                                    }
                                    else
                                    {
                                        while (newUsers.length)
                                        {
                                            var users = newUsers.splice(0, 15);
                                            // Include modes
                                            for (var i = 0; i < users.length; i++)
                                            {
                                                var modeChars = "";
                                                var letterToChar = {
                                                    q: '~',
                                                    a: '&',
                                                    o: '@',
                                                    h: '%',
                                                    v: '+'
                                                }
                                                if ('#' + users[i] == channel)
                                                {
                                                    modeChars += (config.broadcasterMode in letterToChar ? letterToChar[config.broadcasterMode] : '');
                                                    modeChars += '@';
                                                }
                                                if (userList[users[i]].indexOf(config.staffMode) !== -1)
                                                {
                                                    modeChars += (config.staffMode in letterToChar ? letterToChar[config.staffMode] : '');
                                                    if (modeChars.indexOf('@') === -1) modeChars += '@';
                                                }
                                                else if (userList[users[i]].indexOf('a') !== -1)
                                                {
                                                    modeChars += '&';
                                                    if (modeChars.indexOf('@') === -1) modeChars += '@';
                                                }
                                                else if (userList[users[i]].indexOf('o') !== -1 && modeChars.indexOf('@') === -1) modeChars += '@';
                                                
                                                if (userList[users[i]].indexOf('h') !== -1) modeChars += '%';
                                                if (userList[users[i]].indexOf('v') !== -1) modeChars += '+';
                                                
                                                users[i] = modeChars + users[i];
                                            }
                                            users = users.join(' ');
                                            socket.write(':tmi.twitch.tv 353 ' + socket.nick + ' = ' + channel + ' :' + users + '\r\n');
                                        }
                                        socket.write(':tmi.twitch.tv 366 ' + socket.nick + ' ' + channel + ' :End of /NAMES list\r\n');
                                    }
                                    
                                    while (modes.length)
                                    {
                                        var mode = modes.splice(0, 1).toString();
                                        socket.write(':Twitch MODE ' + channel + ' ' + mode + '\r\n');
                                    }
                                }
                            });
                        }
                    }
                }
                socket.channels[channel].update();
            }
        });
    }

    else if (message.command === 'PART')
    {
        message.params[0].split(',').forEach(function (channel)
        {
            if (socket.channels[channel])
            {
                clearInterval(socket.channels[channel].timer);
                delete socket.channels[channel];
            }
        });
    }

    else if (message.command === 'ISON')
    {
        socket.write(':tmi.twitch.tv 303 ' + socket.nick + ' :' + message.params.join(' ') + '\r\n');
        return;
    }

    else if (message.command.toUpperCase() === 'SLOW')
    {
        if (!message.params[1]) message.params[1] = '120';
        socket.irc.write(':tmi.twitch.tv PRIVMSG ' + message.params[0] + ' :/slow ' + message.params[1].trim() + '\r\n');
        return;
    }

    else if (message.command === 'KICK' || message.command.toUpperCase() === 'TIMEOUT')
    {
        if (!message.params[1]) message.params[1] = '';
        if (!message.params[2]) message.params[2] = '600';
        socket.irc.write(':tmi.twitch.tv PRIVMSG ' + message.params[0] + ' :/timeout ' + message.params[1].trim() + ' ' + message.params[2].trim() + '\r\n');
        socket.write(':Twitch NOTICE ' + message.params[0] + ' :You have timed out ' + message.params[1].trim() + ' for ' + message.params[2] + ' seconds.' + '\r\n');
        return;
    }

    else if (message.command.match(/^(?:un)?ban$/i))
    {
        socket.irc.write(':tmi.twitch.tv PRIVMSG ' + message.params[0] + ' :/' + message.command.toLowerCase() + ' ' + message.params[1].trim() + '\r\n');
        socket.write(':Twitch NOTICE ' + message.params[0] + ' :You have ' + message.command.toLowerCase() + 'ned ' + message.params[1].trim() + '\r\n');
        return;
    }

    else if (message.command === 'MODE')
    {
        if (message.params[1] === '+b' || message.params[1] === '-b')
        {
            if (!message.params[2]) return;
            
            if (messageTools.prefixIsHostmask(message.params[2]))
            {
                var hostmask = messageTools.parseHostmaskFromPrefix(message.params[2]);
                var user;
                
                if (hostmask.nickname && hostmask.nickname !== '*')
                {
                    user = hostmask.nickname;
                } else if (hostmask.username && hostmask.username !== '*')
                {
                    user = hostmask.username;
                } else if (hostmask.hostname && hostmask.hostname !== '*')
                {
                    user = hostmask.hostname.split('.')[0];
                } else
                {
                    user = socket.nick;
                }
            } else
            {
                var user = message.params[2];
            }
            
            var command = (message.params[1] === '+b') ? 'ban' : 'unban';
            
            socket.irc.write(':tmi.twitch.tv PRIVMSG ' + message.params[0] + ' :/' + command + ' ' + user + '\r\n');
            socket.write(':Twitch NOTICE ' + message.params[0] + ' :You have ' + command + 'ned ' + user + '.\r\n');
        }
        return;
    }

    else if (message.command === 'WHO')
    {
        socket.write(':tmi.twitch.tv 315 ' + socket.nick + ' ' + message.params[0] + ' :End of /WHO list.' + '\r\n');
        return;
    }
    
    socket.irc.write(data + '\r\n');
}

server.listen(config.relayPort);

console.log("Started");

function parseAndSendUserModes(socket, message, user)
{
    var channel = message.params[0];
    var userList = socket.channels[channel].users;
    
    var modes = "";
    
    if (channel.replace('#', '') === user)
    {
        modes += config.broadcasterMode + 'o';
    }
    
    if (message.tags["user-type"] === 'staff')
    {
        modes += modes.indexOf('o') === -1 ? config.staffMode + 'o' : config.staffMode;
    }
    if (message.tags["user-type"] === 'admin' || message.tags["user-type"] === 'global_mod')
    {
        modes += modes.indexOf('o') === -1 ? "ao" : 'a';
    }
    if (message.tags["user-type"] === 'mod' && modes.indexOf('o') === -1)
    {
        modes += 'o';
    }
    if (message.tags.subscriber === '1')
    {
        modes += 'h';
    }
    if (message.tags.turbo === '1')
    {
        modes += 'v';
    }
    
    var removedModes = "";
    var removedNames = [];
    for (var i = 0; i < userList[user].length; ++i)
    {
        if (modes.indexOf(userList[user][i]) === -1)
        {
            removedModes += userList[user][i];
            removedNames.push(user);
        }
    }
    
    var names = [];
    for (var i = 0; i < modes.length; ++i)
    {
        names.push(user);
    }
    
    var updated = false;
    if (removedModes.length > 0)
    {
        updated = true;
        socket.write(':Twitch MODE ' + channel + ' -' + removedModes + ' ' + removedNames.join(' ') + '\r\n');
    }
    
    if (userList[user] !== modes && modes.length > 0)
    {
        updated = true;
        socket.write(':Twitch MODE ' + channel + ' +' + modes + ' ' + names.join(' ') + '\r\n');
    }
    
    if (updated)
        userList[user] = modes;
}

function sendInParts(socket, data)
{
    if (config.stripTags)
    {
        // Has tags
        if (data[0] === '@')
        {
            data = data.substring(data.indexOf(' :') + 1);
        }
    }
    
    // Message is already short enough
    if (data.length < 510)
    {
        socket.write(data + '\r\n');
        return;
    }
    // Split messages into 512 chunks
    var message = Message(data);
    
    var tags = data[0] === '@' ? data.split(' :')[0] + ' ' : '';
    var messageStart = ':' + message.prefix + ' ' + message.command + ' ' + message.params[0] + ' :';
    
    // Send the message in 510 chunks
    var messageEnd = data.substring(tags.length + messageStart.length);
    var messageLength = (510 - messageStart.length);
    var messageCount = Math.ceil(messageEnd.length / messageLength);
    for (var i = 0; i < messageCount; i++)
    {
        socket.write(tags + messageStart + messageEnd.substr(i * messageLength, messageLength) + '\r\n');
    }
}

function unescapeTag(tag) {
    return tag.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\').replace(/\\r/g, '').replace(/\\n/g, '\u23CE');
}
