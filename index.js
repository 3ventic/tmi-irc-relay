// Keep as false unless you know what you're doing
var eventchat = false;

var net = require('net');
var Message = require("irc-message").parseMessage;
var IRCMessage = require("irc-message").IRCMessage;
var lstream = require("lstream");
var request = require("request");
var messageTools = new IRCMessage();

var slowTopic = {};
var subTopic = {};

var server = net.createServer(function(socket) {
    socket.messageStream = new lstream;
    socket.outgoingMessageStream = new lstream;

    socket.channels = {};

    socket.irc = new net.Socket();
    if (eventchat) {
        socket.irc.connect(80, '199.9.250.117');
    }
    else {
        socket.irc.connect(6667, 'irc.twitch.tv');
    }
    socket.irc.pipe(socket.messageStream);

    socket.messageStream.on('data', function(data) {
        parseIncoming(socket, data);
    });

    socket.on('close', function() {
        Object.keys(socket.channels).forEach(function(channel) {
            clearInterval(socket.channels[channel].timer);
        });
        socket.irc.destroy();
        socket.destroy();
        socket = null;
        delete socket;
    });
    socket.on('error', function(e) {
        console.log(e);
    });
    socket.irc.on('error', function(e) {
        console.log(e);
    });

    socket.outgoingMessageStream.on('data', function(data) {
        parseOutgoing(socket, data);
    });

    socket.pipe(socket.outgoingMessageStream);
});

function parseIncoming(socket, data) {
    var message = Message(data);

    if(message.command === 'MODE') {
        return;
    }

    if(message.prefix === 'jtv!jtv@jtv.tmi.twitch.tv' || message.prefix === 'jtv') {
        var channel = message.params[0];
        var jtvData = message.params[1].split(' ');

        if(channel === socket.nick || !socket.channels[channel]) return;
        
        if(!(channel in slowTopic)) slowTopic[channel] = 'Slow mode is unknown';
        if(!(channel in subTopic)) subTopic[channel] = ' | Subscribers-only unknown';
        
        var userList = socket.channels[channel].users;

        var subscribers = /^This room is (now|no longer) in subscribers-only mode\.$/.test(message.params[1]);

        var slowMode = /^This room is (now|no longer) in slow mode\./.test(message.params[1]);
        
        if(jtvData[0] === 'HOSTTARGET') {
            if (jtvData[1] !== '-') {
                socket.write(':Twitch NOTICE '+channel+' :Now hosting '+jtvData[1]+' with '+jtvData[2]+' viewers\r\n');
            }
        }
        else if(jtvData[0] === 'SPECIALUSER') {
            var user = jtvData[1];

            if(!userList[user]) {
                userList[user] = {
                    owner: false,
                    moderator: false,
                    turbo: false,
                    subscriber: false,
                    admin: false,
                    staff: false
                }
                socket.write(':'+user+'!'+user+'@'+user+'.tmi.twitch.tv JOIN '+channel+'\r\n');
            }

            if(channel.replace('#','') === user && !userList[user].owner) {
                userList[user].owner = true;
                userList[user].moderator = true;
                socket.write(':Twitch MODE '+channel+' +o '+user+' '+user+'\r\n');
            }
            
            if(jtvData[2] === 'staff' && !userList[user].staff) {
                userList[user].staff = true;
                userList[user].moderator = true;
                socket.write(':Twitch MODE '+channel+' +qo '+user+'\r\n');
            }
            if(jtvData[2] === 'admin' && !userList[user].staff) {
                userList[user].admin = true;
                userList[user].moderator = true;
                socket.write(':Twitch MODE '+channel+' +ao '+user+'\r\n');
            }
            if(jtvData[2] === 'subscriber' && !userList[user].subscriber) {
                userList[user].subscriber = true;
                socket.write(':Twitch MODE '+channel+' +h '+user+'\r\n');
            }
            if(jtvData[2] === 'turbo' && !userList[user].turbo) {
                userList[user].turbo = true;
                socket.write(':Twitch MODE '+channel+' +v '+user+'\r\n');
            }
        }
        else if(subscribers) {
            if(message.params[1].indexOf('now') !== -1) {
                subTopic[channel] = ' | Subscribers-only enabled';
                socket.write(':Twitch MODE '+channel+' +m\r\n');
                socket.write(':Twitch TOPIC '+channel+' :'+slowTopic[channel]+subTopic[channel]+'\r\n');
            } else {
                subTopic[channel] = ' | Subscribers-only disabled';
                socket.write(':Twitch MODE '+channel+' -m\r\n');
                socket.write(':Twitch TOPIC '+channel+' :'+slowTopic[channel]+subTopic[channel]+'\r\n');
            }
        }
        else if(slowMode) {
            if(message.params[1].indexOf('now') !== -1) {
                var slowTime = /You may send messages every ([0-9]+) seconds/.exec(message.params[1]);
                slowTopic[channel] = 'Slow mode is '+slowTime[1].trim()+' seconds';
                socket.write(':Twitch MODE '+channel+' +f '+slowTime[1].trim()+'s\r\n');
                socket.write(':Twitch TOPIC '+channel+' :'+slowTopic[channel]+subTopic[channel]+'\r\n');
            } else {
                slowTopic[channel] = 'Slow mode is disabled';
                socket.write(':Twitch MODE '+channel+' -f\r\n');
                socket.write(':Twitch TOPIC '+channel+' :'+slowTopic[channel]+subTopic[channel]+'\r\n');
            }
        }
        else if(jtvData[0] === 'CLEARCHAT') {
            socket.write(':Twitch NOTICE '+channel+' :'+jtvData[1]+' has been timed out or banned\r\n');
        }
        else if(jtvData[0].match(/(?:Now|USERCOLOR|EMOTESET)/)) {
            return;
        }
        else {
            var params = '';
            var length = message.params.length;
            for (var i = 1; i < length; i++) {
                params += ' ' + message.params[i];
            }
            params = params.trim();
            socket.write(':Twitch NOTICE '+channel+' :'+params+'\r\n');
        }
        return;
    }

    socket.write(data+'\r\n');
}

function parseOutgoing(socket, data) {
    
    var message = Message(data);

    if(message.command === 'NICK') {
        socket.nick = message.params[0].trim();
        socket.irc.write('TWITCHCLIENT 3'+'\r\n');
        socket.write(':tmi.twitch.tv 005 '+socket.nick+' PREFIX=(qaohv)~&@$+ CHANTYPES=# NETWORK=Twitch :are supported by this server\r\n');
    }

    else if(message.command === 'JOIN') {
        message.params[0].split(',').forEach(function(channel) {
            socket.channels[channel] = {
                users: {},
                topic: 'Welcome to the channel!',
                timer: setInterval(function() {
                    // Seems to crash without this check, perhaps the client isn't sending a full PART, but simply closes the socket?
                    if (channel in socket.channels) {
                        socket.channels[channel].update();
                    }
                    else {
                        if (timer in socket.channels[channel]) clearInterval(socket.channels[channel].timer);
                        delete socket.channels[channel];
                    }
                }, 30000),
                update: function() {
                    request.get({
                        url: 'https://tmi.twitch.tv/group/user/'+channel.replace('#','')+'/chatters',
                        json: true
                    }, function(err, res, data) {
                        if (err) {
                            console.log(err);
                            return;
                        }
                        // Check the channel wasn't parted during the request, which can take a long time
                        if (!(channel in socket.channels)) {
                            return;
                        }
                        var userList = socket.channels[channel].users;

                        if(data.chatters) {
                            var currentUsers = Object.keys(userList);
                            var newUsers = [];

                            var chatterTypes = Object.keys(data.chatters);
                            for(var i=0; i<chatterTypes.length; i++) {
                                newUsers = newUsers.concat(data.chatters[chatterTypes[i]]);
                            }

                            var joins = [];
                            var parts = [];
                            var modes = [];

                            currentUsers.forEach(function(user) {
                                if(newUsers.indexOf(user) === -1 && socket.nick !== user) {
                                    delete userList[user];
                                    parts.push(user);
                                }
                            });
                            
                            for(var i=0; i<chatterTypes.length; i++) {
                                data.chatters[chatterTypes[i]].forEach(function(user) {
                                    if(!userList[user]) {
                                        userList[user] = {
                                            owner: false,
                                            moderator: false,
                                            turbo: false,
                                            subscriber: false,
                                            admin: false,
                                            staff: false
                                        }
                                        joins.push(user);
                                    }

                                    if(chatterTypes[i] === 'staff' && !userList[user].staff) {
                                        userList[user].staff = true;
                                        modes.push('+qo '+user);
                                    }
                                    else if(chatterTypes[i] === 'admins' && !userList[user].admin) {
                                        userList[user].admin = true;
                                        modes.push('+ao '+user);
                                    }
                                    else if(channel.replace('#','') === user && !userList[user].owner) {
                                        userList[user].owner = true;
                                        modes.push('+o '+user);
                                    }
                                    else if(chatterTypes[i] === 'moderators' && !userList[user].moderator) {
                                        userList[user].moderator = true;
                                        modes.push('+o '+user);
                                        special = true;
                                    }
                                    else if(chatterTypes[i] === 'viewers' && userList[user].moderator && data.chatters['moderators'].length > 0) {
                                        userList[user].moderator = false;
                                        modes.push('-o '+user);
                                    }
                                });
                            }

                            if(joins.length < 100) {
                                while(joins.length) {
                                    var user = joins.splice(0, 1).toString();
                                    if (user != socket.nick) socket.write(':'+user+'!'+user+'@'+user+'.tmi.twitch.tv JOIN '+channel+'\r\n');
                                }
                                while(parts.length) {
                                    var user = parts.splice(0, 1).toString();
                                    socket.write(':'+user+'!'+user+'@'+user+'.tmi.twitch.tv PART '+channel+'\r\n');
                                }
                            } else {
                                while(newUsers.length) {
                                    var users = newUsers.splice(0, 15).join(' ');
                                    socket.write(':tmi.twitch.tv 353 '+socket.nick+' = '+channel+' :'+users+'\r\n');
                                }
                                socket.write(':tmi.twitch.tv 366 '+socket.nick+' '+channel+' :End of /NAMES list\r\n');
                            }

                            while(modes.length) {
                                var mode = modes.splice(0, 1).toString();
                                socket.write(':Twitch MODE '+channel+' '+mode+'\r\n');
                            }
                        }
                    })
                }
            }
            socket.channels[channel].update();
        });
    }

    else if(message.command === 'PART') {
        message.params[0].split(',').forEach(function(channel) {
            if(socket.channels[channel]) {
                clearInterval(socket.channels[channel].timer);
                delete socket.channels[channel];
            }
        });
    }

    else if(message.command === 'ISON') {
        socket.write(':tmi.twitch.tv 303 '+socket.nick+' :'+message.params.join(' ')+'\r\n');
        return;
    }
    
    else if(message.command.toUpperCase() === 'SLOW') {
        if(!message.params[1]) message.params[1] = '120';
        socket.irc.write(':tmi.twitch.tv PRIVMSG '+message.params[0]+' :/slow '+message.params[1].trim()+'\r\n');
        return;
    }

    else if(message.command === 'KICK' || message.command.toUpperCase() === 'TIMEOUT') {
        if(!message.params[2]) message.params[2] = '600';
        socket.irc.write(':tmi.twitch.tv PRIVMSG '+message.params[0]+' :/timeout '+message.params[1].trim()+' '+message.params[2].trim()+'\r\n');
        socket.write(':Twitch NOTICE '+message.params[0]+' :You have timed out '+message.params[1].trim()+' for '+message.params[2]+' seconds.'+'\r\n');
        return;
    }
    
    else if(message.command.match(/^(?:un)?ban$/i)) {
        socket.irc.write(':tmi.twitch.tv PRIVMSG '+message.params[0]+' :/'+message.command.toLowerCase()+' '+message.params[1].trim()+'\r\n');
        socket.write(':Twitch NOTICE '+message.params[0]+' :You have '+message.command.toLowerCase()+'ned '+message.params[1].trim()+'\r\n');
        return;
    }

    else if(message.command === 'MODE') {
        if(message.params[1] === '+b' || message.params[1] === '-b') {
            if(!message.params[2]) return;

            if(messageTools.prefixIsHostmask(message.params[2])) {
                var hostmask = messageTools.parseHostmaskFromPrefix(message.params[2]);
                var user;

                if(hostmask.nickname && hostmask.nickname !== '*') {
                    user = hostmask.nickname;
                } else if(hostmask.username && hostmask.username !== '*') {
                    user = hostmask.username;
                } else if(hostmask.hostname && hostmask.hostname !== '*') {
                    user = hostmask.hostname.split('.')[0];
                } else {
                    user = socket.nick;
                }
            } else {
                var user = message.params[2];
            }

            var command = (message.params[1] === '+b') ? 'ban' : 'unban';

            socket.irc.write(':tmi.twitch.tv PRIVMSG '+message.params[0]+' :/'+command+' '+user+'\r\n');
            socket.write(':Twitch NOTICE '+message.params[0]+' :You have '+command+'ned '+user+'.\r\n');
        }
        return;
    }

    else if(message.command === 'WHO') {
        socket.write(':tmi.twitch.tv 315 '+socket.nick+' '+message.params[0]+' :End of /WHO list.'+'\r\n');
        return;
    }
    
    socket.irc.write(data+'\r\n');
}

if (eventchat) server.listen(6970);
else server.listen(6969);
