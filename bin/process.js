module.exports = new (class Cli {
    constructor(){
        this.prompt = "AstroManger> "
        this.cache = ""
        this.rl = null
        let events = require("events")
        this.events = new events.EventEmitter()
        this.wait = false
        //Colors
        this.colors = {
            Reset: "\x1b[0m",
            Bright: "\x1b[1m",
            Dim: "\x1b[2m",
            Underscore: "\x1b[4m",
            Blink: "\x1b[5m",
            Reverse: "\x1b[7m",
            Hidden: "\x1b[8m",
            //
            Black: "\x1b[30m",
            Red: "\x1b[31m",
            Green: "\x1b[32m",
            Yellow: "\x1b[33m",
            Blue: "\x1b[34m",
            Magenta: "\x1b[35m",
            Cyan: "\x1b[36m",
            White: "\x1b[37m",
        }
        //Spinner
        this.spinnerState = 0
        this.spinnerString = "░▓"//'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
        let self = this
        this.spinning = false
        this.spinData = ""
        this.spinloop = null
        this.spinner = async function(callback){
            //Rainbow
            let index = Math.floor(Math.random() * Object.keys(this.colors).length-1).toFixed(0)
            if(index < 8) index = 8
            if(index > 13) index = 13
            let state = self.spinnerState
            self.spinnerState = self.spinnerState + 1
            if(self.spinnerString.split("")[self.spinnerState] == undefined){
                self.spinnerState = 0
            }
            callback(this.colors[Object.keys(this.colors)[index]] + self.spinnerString.split("")[state] + this.colors["Reset"])
        }
    }
    /**
     * Handle the process STDIN data.
     * @param data Data from the terminal input
     */
    async stdin(data){
        if(data != "\r"){
            this.cache = this.cache + data
            if(this.cache.includes("\b")){
                await process.stdout.clearLine()
                await process.stdout.cursorTo(0, process.stdout.rows)
                let temp = this.cache
                temp = temp.split("")
                temp.splice(temp.length-2,2)
                this.cache = temp.join("")
                process.stdout.write(this.prompt + this.cache)
            }
            this.cursor = this.rl.cursor
            return;
        }
        //Handle command
        switch(this.cache){
            case "ping":
                if(this.wait) return;
                this.log("Pong!", null, false, true)
                break
            case "stop":
                if(this.wait) return;
                process.emit("SIGINT")
                break;
            case "restart": 
                if(this.wait) return;
                global.restart = true
                process.emit("SIGINT")
                break;
            case "status":
                if(this.wait) return;
                if(global._ != undefined && global._.rconActive == true){
                    global._.command.getStatistics().then(async data => {
                        //this.log(require("util").inspect(data, true, 5))
                        this.log("\nVersion: " + data.build + "\nOwner: " + data.ownerName + "\nUrl: " + data.serverURL + "\nPassword protected: " + data.hasServerPassword + "\nWhitelist: " + data.isEnforcingWhitelist + "\nCreative: " + data.creativeMode + "\nSavegame: " + data.saveGameName + "\nFPS: " + data.averageFPS + "\nIdle: " + (data.playersInGame == 0) + "\nUnique players: " + data.playersKnownToGame + "\n")
                    }).catch(async err => {
                        this.log(err, "Red")
                    })
                }else {
                    this.log("Server terminal not connected", "Red")
                }
                break;
            case "save":
                if(this.wait) return;
                if(global._ != undefined && global._.rconActive == true){
                    let time = new Date().getTime()
                    this.log("[INFO]: Saving game...", "Blue", true)
                    global._.command.save().then(async () => {
                        this.log("Game saved (" + ((new Date().getTime() - time) * 0.001) + "s)", "Green")
                    }).catch(async err => {
                        this.log(err, "Red")
                    })
                }else {
                    this.log("Server terminal not connected", "Red")
                }
                break;
            case "list":
                if(this.wait) return;
                if(global._ != undefined && global._.rconActive == true){
                    global._.command.getPlayers().then(async res => {
                        let construct = []
                        let count = 0
                        res.playerInfo.forEach(async player => {
                            if(player.inGame == true) construct.push(player.playerName + "(" + player.playerGuid + ")")
                            ++count
                            if(count == res.playerInfo.length){
                                this.log(construct.length == 0 ? "Nobody is online" : "-" + construct.join("\n- "))
                            }
                        })
                    }).catch(async err => {
                        this.log(err, "Red")
                    })
                }else {
                    this.log("Server terminal not connected", "Red")
                }
                break;
            case "mods":
                if(this.wait) return;
                let construct = []
                global._.mods.forEach(async mod => {
                    construct.push(mod.name + "(" + mod.version )
                })
                break;
            case "help": 
                if(this.wait) return;
                let commands = [
                    '"help" - Displays this message',
                    '"ping" - Test the the AstroManager console',
                    '"stop" - Stop the Astroneer Dedicated server',
                    '"status" - Get the server status',
                    '"restart" - Restart the server and AstroManager',
                    '"save" - Save the game',
                    '"list" - Get the list of players online',
                    '"kick <player guid / player name>" - Kick a player',
                    '"kickall" - Kick all players',
                    '"whitelist <on / off>" - Toggle the whitelist on or off',
                    '"whitelist add <player guid / player name>" - Whitelist a player',
                    '"whitelist remove <player guid / player name>" - Remove a player from the whitelist',
                    '"saves" - Get the current available savegames',
                    '"load <savename>" - Load a savegame"',
                    '"create <savename>" - Create a new savegame',
                    '"op <player guid / player name>" - Make a player admin',
                    '"ban <player guid / player name>" - Ban a player',
                    '"mods" - List the loaded mods'
                ]
                this.log("\n [ AstroManager - Commands ]\n    " + commands.join("\n    "))
                break;
            case "n":
                this.events.emit("pick", false)
                break
            case "y":
                this.events.emit("pick", true)
                break
            default: 
                if(this.wait) return;
                this.log("No such command, use 'help' for help.", "Red", false, true)
                break
        }
        this.cache = ""
        this.cursor = 0
    }

    /**
     * Data to log
     * @param {""} data 
     */
    async log(data, color, spinner, cmd, noDate){
        if(data == undefined || typeof data != "string") return;
        let dataCache = this.rl.line
        let rows = process.stdout.rows
        let time = noDate ? "" : "[" + new Date().getHours() + ":" + new Date().getMinutes() + ":" + new Date().getSeconds() + "] "
        process.stdout.clearLine()
        process.stdout.cursorTo(0, rows)
        this.spinning = false
        let self = this
        async function _log(){
            if(spinner){
                self.spinning = true
                self.spinData = {
                    data: data,
                    color: color
                }
                console.log("")
                self.spinloop = setInterval(async () => {
                    process.stdout.moveCursor(-1, -1)
                    process.stdout.clearLine()
                    self.spinner(async (spin) => {
                        if(color != undefined && self.colors[color] != undefined){
                            console.log(spin, self.colors[color], data, self.colors["Reset"])
                            //process.stdout.write(self.prompt + dataCache)
                        }else {
                            console.log(spin, data)
                            //process.stdout.write(self.prompt + dataCache)
                        }
                    })
                    process.stdout.moveCursor(1, 0)
                }, 180)
            }else {
                if(color != undefined && self.colors[color] != undefined){
                    if(cmd){
                        console.log(self.prompt + dataCache)
                        console.log(time + self.colors[color], data, self.colors["Reset"])
                        await process.stdout.cursorTo(0, process.stdout.rows)
                        process.stdout.write(self.prompt)
                    }else {
                        console.log(time + self.colors[color], data, self.colors["Reset"])
                        process.stdout.write(self.prompt + dataCache)
                    }
                }else {
                    if(cmd){
                        console.log(self.prompt + dataCache)
                        console.log(time + data)
                        await process.stdout.cursorTo(0, process.stdout.rows)
                        process.stdout.write(self.prompt)
                    }else {
                        console.log(time + data)
                        process.stdout.write(self.prompt + dataCache)   
                    }
                }
            }
        }
        if(this.spinloop != null) {
            clearInterval(this.spinloop)
            this.spinloop = null
            if(this.spinData.color != undefined){
                process.stdout.moveCursor(-1, -1)
                process.stdout.clearLine()
                process.stdout.write((data.includes("[ERROR]") ? "X  ": "√") + "  " + this.colors[(data.includes("[ERROR]") ? "Red" : "Green")] + this.spinData.data + this.colors["Reset"])
                console.log("")
                _log()
            }else {
                process.stdout.moveCursor(-1, -1)
                process.stdout.clearLine()
                process.stdout.write((data.includes("[ERROR]") ? "X  ": "√") + "  " + this.spinData.data + this.colors["Reset"])
                console.log("")
                _log()
            }
        }else {
            _log()
        }
    }

    /**
     * Create the RL interface
     * @param {*} set RL interface
     */
    async init(set){
        this.rl = set
    }
})