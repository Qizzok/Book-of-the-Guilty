"use strict";

const fs = require('fs');

function handle_reject(err) {
    console.error(`Promise rejected with reason ${err}`);
}

function load(path) {
    return new Promise((resolve, reject) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if (err) {
                console.error(`Failed to load from file ${path}`);
                reject();
            } else {
                try {
                    resolve(JSON.parse(data));
                } catch(json_err) {
                    console.error(`Failed to parse json from ${path} with error ${json_err}`)
                    resolve(data);
                }
            }
        });
    });
}

function save(data, path) {
    try {
        let toWrite = JSON.stringify(data);
        fs.writeFile(path, toWrite, (err) => {
            if (err) {
                console.error(`Failed to write to file path ${path}`)
            }
        });
    } catch(json_err) {
        console.error(`Failed to save json string writing to ${path} with error ${json_err}`);
    }
}



class PObj {
    constructor(path) {
        this.path = path;
        this.data = {};

        this.loadData();
    }

    write(newData) {
        this.data = newData;
        save(newData, this.path);
    }

    val(prop) {
        return this.data[prop];
    }

    set(prop, val) {
        this.data[prop] = val;
        save(this.data, this.path);
    }

    loadData() {
        load(this.path).then((read) => {
            this.data = read;
        }, handle_reject);
    }
}

module.exports = {
    PObj: PObj
}
