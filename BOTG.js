"use strict";

const Discord = require('discord.js');
const _ = require('lodash');
const fs = require('fs');
const https = require('https');
const persist = require('./Persist.js');

const client = new Discord.Client();
var channel;

const ttl = 1000 * 60 * 20; // Keep attachments for 20 minutes
const relog = 1000 * 30; // Relog after 30 seconds
const retry = 1000 * 60 * 5; // Retry failed login after 5 minutes

const logMassDelete = true;

let pobj = new persist.PObj('./servers.json');

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('message', message => {
    if (message.author.id === client.user.id || !message.guild) return;

    message.guild.fetchMember(message.author).then(author => {
        if (message.content.indexOf('!muterole') === 0 && author.highestRole) {
            let server = pobj.val(message.guild.id) || {};
            let muterole = message.guild.roles.find('name', server.muteRole || 'Muted');

            if(!muterole || Discord.Role.comparePositions(author.highestRole, muterole) > 0) {
                let roleName = message.content.slice(10);
                if (message.guild.roles.find('name', roleName)) {
                    server.muteRole = roleName;
                    pobj.set(message.guild.id, server);
                    message.channel.send(`Set muted role to ${roleName}`);
                } else {
                    message.channel.send(`Could not find role ${roleName}`);
                }
            }
        }

        if (message.content.indexOf('!logchannel') === 0 && author.highestRole) {
            let server = pobj.val(message.guild.id) || {};
            let muterole = message.guild.roles.find('name', server.muteRole || 'Muted');

            if (!muterole || Discord.Role.comparePositions(author.highestRole, muterole) > 0) {
                let channelName = message.content.slice(12);
                if (message.guild.channels.find('name', channelName)) {
                    server.logChannel = channelName;
                    pobj.set(message.guild.id, server);
                    message.channel.send(`Set log channel to ${channelName}`);
                } else {
                    message.channel.send(`Could not find channel ${channelName}`);
                }
            }
        }
    }).catch(err => {
        console.log(err);
    });

    const attachments = message.attachments.array();

    if (attachments && attachments.length) {
        for (let i = attachments.length - 1; i >= 0; i--) {
            download(attachments[i].url, `./Download/${message.id}|${attachments[i].filename}`);
        }
    }
});

client.on('guildMemberUpdate', processMemberUpdate);

function processDelete(message) {
    if (message.channel.type !== 'text' || message.author.id === client.user.id) return;

    let server = pobj.val(message.guild.id) || {};
    let logChannel = server.logChannel || 'Modlog';

    const attachments = message.attachments.array();
    const channel = message.guild.channels.find('name', logChannel);
    let promises = [];

    if (attachments && attachments.length && channel) {
        for (let i = attachments.length - 1; i >= 0; i--) {
            let path = `./Download/${message.id}|${attachments[i].filename}`;
            promises.push(checkFile(path, attachments[i].filename));     
        }

        Promise.all(promises).then(locals => {
            let have = _.remove(locals); // All truthy
            if(have.length) {
                channel.send(`Deleted file uploaded by ${message.author.tag}`, {
                    files: have
                });
            }
        });
    }
}

client.on('messageDelete', processDelete);

client.on('messageDeleteBulk', messages => {
    if (!logMassDelete) return;

    for (let i = 0; i < messages.array().length; i++) {
        processDelete(messages.array()[i]);
    }
});

client.on('error', error => {
    console.error(error);
});

client.on('disconnect', () => {
    console.log(`Lost connection, attempting to reconnect in ${reconnect}ms.`);
    setTimeout(login, reconnect);
});


function login() {
    fs.readFile('./token', 'utf8', (err, data) => {
        if (err) {
            console.error(`Could not load token with reason ${err}. Retryig in ${retry}ms.`);
            setTimeout(login, retry);
        } else {
            client.login(data.trim()).then(token => {
                console.log('login call successful');
            }, error => {
                console.error(`Failed to log in with reason ${error}. Retrying in ${retry}ms.`);
                setTimeout(login, retry);
            });
        }
    });
}

// Adapted from
// https://stackoverflow.com/questions/11944932/how-to-download-a-file-with-node-js-without-using-third-party-libraries#22907134

function download(url, dest) {
    let file = fs.createWriteStream(dest);
    let request = https.get(url, function(response) {
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            setTimeout(() => {
                fs.unlink(dest, err => {
                    if (err) {
                        if (err.code === 'ENOENT') {
                            console.log(`file at ${dest} already deleted`);
                        } else {
                            console.error(err);
                        }
                    }
                });
            }, ttl)
        });
    }).on('error', err => { // Handle errors
        console.error(err);
        fs.unlink(dest, err => {
            if (err) console.error(err);
        }); // Delete the file async. (But we don't check the result)
    });
}

function checkFile(path, filename) {
    return new Promise((resolve, reject) => {
        fs.access(path, fs.constants.F_OK, err => {
            if (!err) {
                resolve({
                    attachment: path,
                    name: filename
                });
            }
            resolve();
        })
    })
}

function processMemberUpdate(pre, post) {
    let server = pobj.val(post.guild.id) || {};
    let muteRole = server.muteRole || 'Muted';
    if (pre.highestRole.name === muteRole && post.highestRole.name !== muteRole) {
        unmuteMember(post);
    } else if (pre.highestRole.name !== muteRole && post.highestRole.name === muteRole) {
        muteMember(post);
    }
}

function muteMember(member) {
    let server = pobj.val(member.guild.id) || {};
    let muteRole = server.muteRole || 'Muted'; 
    let roles = member.roles.filter(role => role.name !== muteRole) || [];
    member.removeRoles(roles, 'Member Muted').then(val=> {}, err => console.log(`Failed to remove roles with reason ${err}`));
    server[member.id] = roles.map(role => role.id);
    pobj.set(member.guild.id, server);
}

function unmuteMember(member) {
    let server = pobj.val(member.guild.id) || {};
    let roles = server[member.id] || [];
    member.addRoles(roles, 'Member Unmuted').then(val=> {}, err => console.log(`Failed to assign roles with reason ${err}`));;
    delete server[member.id];
    pobj.set(member.guild.id, server);
}

login();
