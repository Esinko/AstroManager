/* Require */
const cp = require("child_process")
const express = require("express")
const _git = require("simple-git")
const fs = require("fs")
const https = require("https")
const http = require("http")
global.regedit = null
try {
    if(!fs.existsSync("./bin/build/regedit")) throw "-"
    global.regedit = require("./bin/build/regedit")
}
catch(err){
    //regedit = null
}
const path = require("path")
const interface = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
})
const extract = require('extract-zip')
const rcon = require("./bin/rcon.js")
const mod = require("./bin/mod.js")
/* Git */
const git = _git()

/* RL */
const cli = require("./bin/process.js")
cli.init(interface)
process.stdin.on("data", async (data) => {
    cli.stdin(data)
})
/* Memory */
const exitCodes = { //Server exit code meanings
    "3221225786": "Closed by clicking the X button on the server window or killed by an external program.",
    "0": "Server shutdown or failed to register to PlayFab. If you believe this is an error, check your network configurations and restart.",
    "null": "Server process killed by AstroManager.",
    "1": "An error occured in the server or it was killed by an external program/AstroManager at startup."
}
const configNameTranslation = { //Convert config value names
    "bLoadAutoSave": "loadAutoSave",
    "MaxServerFramerate": "maxFramerate",
    "MaxServerIndleFramerate": "maxIdleFramerate",
    "PublicIP": "publicIP",
    "ServerName": "serverName",
    "OwnerName": "ownerName",
    "OwnerGuid": "ownerGuid",
    "PlayerActivityTimeout": "playerIdleTimeout",
    "AutoSaveGamesInterval": "autosaveInterval",
    "BackupSaveGamesInterval": "backupInterval",
    "Port": "port",
    "MaxClientRate": "clientRatelimit",
    "MaxInternetClientRate": "internetClientRatelimit",
    "ConsolePort": "consolePort",
    "MaxPlayers": "maxPlayers",
    "Heartbeat": "heartbeat"
}

//Memo: Suspend, pslist chrome -s 1 -m, psinfo

/* Memory */
async function define(){
    global._ = {
        process: null,
        system: null,
        sessionTicket: null,
        registratioWaitLoop: null,
        serverGuid: null,
        server: {},
        rconActive: false,
        rcon: null,
        command: null,
        interrupt: false,
        shutdown: false,
        session: null,
        playfabHeartbeat: null,
        mods: []
    }
    global.tries = 0
    global.restart = false
}
define()

/* Classes */
const tools = new (class Tools {
    async getInstallPath(sixfourbit){
        return new Promise(async (resolve, reject) => {
            try {  
                this.setTerminalTitle("AstroManager - Fetching server installation path...")
                global.regedit.list("HKLM\\SOFTWARE\\" + (sixfourbit ? "WOW6432Node\\" : "") + "Valve\\Steam", sixfourbit ? "64" : "32", async (error, result) => {
                    if(error != null){
                        reject(error)
                    }else {
                        let steamPath = result[Object.keys(result)[0]].values.InstallPath.value
                        if(fs.existsSync(steamPath)){
                            let paths = []
                            //Get the normal path if it exists
                            if(fs.existsSync(steamPath + "\\steamapps\\common\\ASTRONEER Dedicated Server\\")){
                                paths.push({
                                    name: "0",
                                    value: steamPath + "\\steamapps\\common\\ASTRONEER Dedicated Server\\"
                                })
                            }
                            //Get other paths
                            fs.readFile(steamPath + "\\config\\config.vdf", "utf8", async (err, data) => {
                                if(err != null){
                                    reject(err)
                                }else {
                                    //Format the response to be readable
                                    data = data.replace(/(	{0,}}\n)/g, "").replace(/(	{0,}{\n)/g, "").replace(/("		")/g, "=").replace(/(	{1,})/g, "")
                                    data = data.split("\n")
                                    let count = 0
                                    data.forEach(async line => {
                                        line = line.replace(/"/g, "")
                                        line = line.split("=")
                                        let name = line[0]
                                        let value = line[1] != undefined ? line[1].replace(/(\\\\)/g, "\\") : null //Fix duplicated letters and get the value
                                        if(name.startsWith("BaseInstallFolder_")){
                                            paths.push({
                                                name: name.split("_")[1],
                                                value: value + "\\steamapps\\common\\ASTRONEER Dedicated Server\\"
                                            })
                                        }
                                        ++count
                                        if(count == data.length){
                                            resolve(paths)
                                        }
                                    })
                                }
                            })
                        }else {
                            reject("Cannot locate steam config.vdf path.")
                        }
                    }
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
    /**
     * Get system data. Information about the processor and such. This info is needed because this program can run in 64bit and 32bit, which changes the registry locations of some other required data.
     */
    async getSystemData(){
        return new Promise(async (resolve, reject) => {
            try {
                this.setTerminalTitle("AstroManager - Fetching system data...")
                global.regedit.list("HKLM\\Hardware\\Description\\System\\CentralProcessor\\0", async (error, response) => {
                    if(error != null){
                        reject(error)
                    }else {
                        let system = {}
                        if(response["HKLM\\Hardware\\Description\\System\\CentralProcessor\\0"].values["Identifier"].value.includes("64")){
                            //We are running in 64bit
                            system.arch = "64"
                            let cmd = cp.exec('"./bin/build/ps/psinfo64.exe"', async (error, stdout, stderr) => {
                                if(error != null){
                                    reject(error)
                                }else {
                                    let response = stdout.split("Uptime")[1].split("\n")
                                    response[0] = "Uptime" + response[0]
                                    let count = 0
                                    response.forEach(async line => {
                                        let name = line.split(":")[0].split(" ").join("_")
                                        let data = line.replace(/(.{1,}: {1,})/g, "")
                                        system[name] = data
                                        ++count
                                        if(count == response.length){
                                            resolve(system)
                                        }
                                    })
                                }
                            })
                            cmd.on("exit", async (code) => {
                                if(code == 0){
                                    //Valid exit
                                }else {
                                    reject("Unexpected error code while running psinfo. Code: " + code + " Data: ")
                                }
                            })
                        }else if(response["HKLM\\Hardware\\Description\\System\\CentralProcessor\\0"].values["Identifier"].value.includes("32")){
                            //We are running in 32bit
                            system.arch = "32"
                            let cmd = cp.exec('"./bin/build/ps/psinfo.exe"', async (error, stdout, stderr) => {
                                if(error != null){
                                    reject(error)
                                }else {
                                    let response = stdout.split("Uptime")[1].split("\n")
                                    response[0] = "Uptime" + response[0]
                                    let count = 0
                                    response.forEach(async line => {
                                        let name = line.split(":")[0].split(" ").join("_")
                                        let data = line.replace(/(.{1,}: {1,})/g, "")
                                        system[name] = data
                                        ++count
                                        if(count == response.length){
                                            resolve(system)
                                        }
                                    })
                                }
                            })
                            cmd.on("exit", async (code) => {
                                if(code == 0){
                                    //Valid exit
                                }else {
                                    reject("Unexpected error code while running psinfo. Code: " + code + " Data: ")
                                }
                            })
                        }else {
                            reject("Unkown processor architecture. This program should not have ran at all, but if you've gotten this far. Good luck.")
                        }
                    }
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
    async welcomeMessage(){
        return new Promise(async (resolve, reject) => {
            try {
                this.setTerminalTitle("AstroManager - Please wait...")
                fs.readFile(path.join(__dirname, "./bin/title.txt"), "utf8", async (err, data) => {
                    if(err != null){
                        reject(err)
                    }else {
                        data = data.split("\n")
                        let count = 0
                        data.forEach(async line => {
                            cli.log(line, undefined, undefined, undefined, true)
                            ++count
                            if(count == data.length){
                                cli.log("Welcome to AstroManager! Please while we get setup...", "Blue", true)
                                resolve()
                            }
                        })
                    }
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
    async writeSettings(){
        return new Promise(async (resolve, reject) => {
            try {
                let settings = ""
                let engine = ""
                let user = ""
                if(fs.existsSync(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\AstroServerSettings.ini") && fs.existsSync(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\Engine.ini") && fs.existsSync(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\GameUserSettings.ini")){
                    fs.readFile(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\AstroServerSettings.ini", "utf8", async (err, data) => {
                        if(err != null){
                            reject(err)
                        }else {
                            settings = data
                            fs.readFile(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\Engine.ini", "utf8", async (err2, data2) => {
                                if(err2 != null){
                                    reject(err)
                                }else {
                                    engine = data2
                                    fs.readFile(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\GameUserSettings.ini", "utf8", async (err3, data3) => {
                                        if(err3 != null){
                                            reject(err)
                                        }else {
                                            user = data3
                                            //All the files have been read
                                            //Handle settings
                                            settings = settings.split("\n")
                                            let count = 0
                                            settings.forEach(async line => {
                                                if(!line.startsWith("[")){
                                                    let name = line.split("=")[0]
                                                    if(configNameTranslation[name] != undefined){
                                                        settings[count] = name + "=" + global.config["Astroneer-Dedicated-Server"][configNameTranslation[name]]
                                                    }
                                                }
                                                //Get server guid
                                                if(line.startsWith("ServerGuid")){
                                                    global._.serverGuid = line.split("=")[1]
                                                    if(line.split("=")[1] == ""){
                                                        reject("Unexpected error: Server GUID empty.")
                                                    } 
                                                }
                                                //Heartbeat
                                                if(line.startsWith("HeartbeatInterval")){
                                                    line = "HeartbeatInterval=0"
                                                }
                                                //Continue
                                                ++count
                                                if(count == settings.length){
                                                    //Add consoleport
                                                    if(!settings.join("\n").includes("ConsolePort=")){
                                                        settings.push("ConsolePort=" + global.config["Astroneer-Dedicated-Server"].consolePort)
                                                    }
                                                    //Add heartbeat
                                                    if(!settings.join("\n").includes("Heartbeat=Interval0")){
                                                        settings.push("HeartbeatInterval=0")
                                                    }
                                                    count = 0
                                                    //Handle engine
                                                    if(engine.length < 4){
                                                        engine = "[URL]\nPort=" + global.config["Astroneer-Dedicated-Server"].port + "\n[/Script/OnlineSubsystemUtils.IpNetDriver]\nMaxClientRate=" + global.config["Astroneer-Dedicated-Server"].clientRatelimit + "\nMaxInternetClientRate=" + global.config["Astroneer-Dedicated-Server"].internetClientRatelimit
                                                    }
                                                    engine = engine.split("\n")
                                                    engine.forEach(async line => {
                                                        if(!line.startsWith("[")){
                                                            let name = line.split("=")[0]
                                                            if(configNameTranslation[name] != undefined){
                                                                engine[count] = name + "=" + global.config["Astroneer-Dedicated-Server"][configNameTranslation[name]]
                                                            }
                                                        }
                                                        ++count
                                                        if(count == engine.length){
                                                            count = 0
                                                            user = user.split("\n")
                                                            user.forEach(async line => {
                                                                if(!line.startsWith("[")){
                                                                    let name = line.split("=")[0]
                                                                    if(configNameTranslation[name] != undefined){
                                                                        user[count] = name + "=" + global.config["Astroneer-Dedicated-Server"][configNameTranslation[name]]
                                                                    }
                                                                }
                                                                ++count
                                                                if(count == user.length){
                                                                    //All done, write the data back to the files
                                                                    settings = settings.join("\n").replace(/(?:\h*\n){2,}/g, "")
                                                                    engine = engine.join("\n").replace(/(?:\h*\n){2,}/g, "")
                                                                    user = user.join("\n").replace(/(?:\h*\n){2,}/g, "")
                                                                    fs.writeFile(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\AstroServerSettings.ini", settings, "utf8", async (err) => {
                                                                        if(err != null){
                                                                            reject(err)
                                                                        }else {
                                                                            fs.writeFile(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\Engine.ini", engine, "utf8", async (err) => {
                                                                                if(err != null){
                                                                                    reject(err)
                                                                                }else {
                                                                                    fs.writeFile(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\GameUserSettings.ini", user, "utf8", async (err) => {
                                                                                        if(err != null){
                                                                                            reject(err)
                                                                                        }else {
                                                                                            //Everything done!
                                                                                            resolve()
                                                                                        }
                                                                                    })
                                                                                }
                                                                            })
                                                                        }
                                                                    })
                                                                }
                                                            })
                                                        }
                                                    })
                                                }
                                            })
                                        }
                                    })
                                }
                            })
                        }
                    })
                }else {
                    reject(null)
                }
            }
            catch(err){
                reject(err)
            }
        })
    }
    async set(location, name, value){
        return new Promise(async (resolve, reject) => {
            try {
                if(location != ""){
                    global.config[location][name] = value
                }else {
                    global.config[name] = value
                }
                fs.writeFile("./config.json", JSON.stringify(config), async (err) => {
                    if(err != null){
                        reject(err)
                    }else {
                        setTimeout(async () => {
                            config = require("./config.json")
                            if(global.config[location][name] == value){
                                resolve()
                            }else {
                                reject("Value did not get written. Please restart")
                            }
                        }, 1000)
                    }
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
    async acceptSysinternalsEula(){
        return new Promise(async (resolve, reject) => {
            try {
                this.setTerminalTitle("AstroManager - Checking eulas...")
                if(global.config["AstroManager"].systeminternalsEula == false){
                    let eula = cp.exec('start /WAIT "Accept the Eula" ""./bin/SysInternalsEula.bat""', async (err) => {
                        if(err != null){
                            reject(err)
                        }
                    })
                    eula.on("exit", async (code) => {
                        if(fs.existsSync("./bin/eula.txt")){
                            fs.readFile("./bin/eula.txt", "utf16le", async (err, data) => {
                                if(err != null){
                                    reject(err)
                                }else {
                                    if(data.split("\n")[0].includes("Eula declined.")){
                                        process.exit()
                                    }else {
                                        fs.unlink("./bin/eula.txt", async (err) => {
                                            if(err != null){
                                                reject(err)
                                            }else {
                                                resolve()
                                            }
                                        })
                                    }
                                }
                            })
                        }else {
                            reject("Cannot locate eula process log file.")
                        }
                    })
                }else {
                    resolve()
                }
            }
            catch(err){
                reject(err)
            }
        })
    }
    async setTerminalTitle(title){
        process.stdout.write(String.fromCharCode(27) + "]0;" + title + String.fromCharCode(7));
    }
})
const network = new (class Network {
    async checkPortForward(){
        
    }
    async checkFirewall(){

    }
    async setupFirewall(){
        
    }
    async playfabHeartbeat(){
        return new Promise(async (resolve, reject) => {
            try {
                let options = {
                    method: "POST",
                    hostname: '5EA1.playfabapi.com',
                    path: '/Client/ExecuteCloudScript?sdk=UE4MKPL-1.19.190610',
                    port: 443,
                    headers: {
                        "Content-Type": "application/json",
                        "X-Authorization": global._.sessionTicket,
                        "User-Agent": "game=Astro, engine=UE4, version=4.18.2-0+++UE4+Release-4.18, platform=Windows, osver=6.2.9200.1.256.64bit"
                    } 
                }
                let req = https.request(options, async (res) => {
                    res.setEncoding("utf8")
                    let collection = ""
                    res.on("data", async data => {
                        collection = collection + data
                    })
                    res.on("end", async () => {
                        collection = JSON.parse(collection)
                        if(collection.code == "200" && collection.status == "OK"){
                            resolve()
                        }else {
                            reject("Error while trying to send heartbeat request: " + JSON.stringify(collection), "Red")
                        }
                    })
                })
                //Continue
                global._.command.getPlayers().then(async res => {
                    let ingame = 0
                    for(let i = 0; i < res.playerInfo.length;i++){if(res.playerInfo[i].inGame == true) ++ingame}
                    req.write(JSON.stringify({
                        FunctionName: "heartbeatDedicatedServer",
                        FunctionParameter: {
                            serverName: JSON.stringify({
                                customdata: {
                                    ServerName: global.config.ServerRegistry.name,
                                    ServerType: global.config.ServerRegistry.type,
                                    ServerPaks: global.config.Mods.enabled == true ? global._.mods : []
                                }
                            }),
                            buildVersion: global._.server['Tags']['gameBuild'],
                            gameMode: global._.server['GameMode'],
                            ipAddress: global._.server['ServerIPV4Address'],
                            port: global._.server['ServerPort'],
                            matchmakerBuild: global._.server['BuildVersion'],
                            maxPlayers: global._.server['Tags']['maxPlayers'],
                            numPlayers: ingame,
                            lobbyId: global._.server['LobbyID'],
                            publicSigningKey: global._.server['Tags']['publicSigningKey'],
                            requiresPassword: global._.server['Tags']['requiresPassword']
                        },
                        GeneratePlayStreamEvent: true
                    }))
                    req.end()
                }).catch(async err => {
                    reject(err)
                    req.end()
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
    async deRegisterPlayfab(){
        return new Promise(async (resolve, reject) => {
            try {
                let options = {
                    method: "POST",
                    hostname: '5EA1.playfabapi.com',
                    path: '/Client/ExecuteCloudScript?sdk=UE4MKPL-1.19.190610',
                    port: 443,
                    headers: {
                        "Content-Type": "application/json",
                        "X-Authorization": global._.sessionTicket,
                        "User-Agent": "game=Astro, engine=UE4, version=4.18.2-0+++UE4+Release-4.18, platform=Windows, osver=6.2.9200.1.256.64bit"
                    } 
                }
                let req = https.request(options, async (res) => {
                    res.setEncoding("utf8")
                    let collection2 = ""
                    res.on("data", async data => {
                        collection2 = collection2 + data
                    })
                    res.on("end", async () => {
                        collection2 = JSON.parse(collection2)
                        cli.log(require("util").inspect(collection2, true, 5))
                    })
                })
                req.write(JSON.stringify({
                    FunctionName: "deregisterDedicatedServer",
                    FunctionParameter: {
                        lobbyId: lobbyID
                    },
                    "GeneratePlayStreamEvent": True
                }))
                req.end()
            }
            catch(err){
                reject(err)
            }
        })
    }
    async getPlayfabRegistration(){
        return new Promise(async (resolve, reject) => {
            try {
                //Get the session ticket fits
                let options = {
                    method: "POST",
                    hostname: '5EA1.playfabapi.com',
                    path: '/Client/LoginWithCustomID?sdk=UE4MKPL-1.19.190610',
                    port: 443,
                    headers: {
                        "Content-Type": "application/json",
                        "User-Agent": "game=Astro, engine=UE4, version=4.18.2-0+++UE4+Release-4.18, platform=Windows, osver=6.2.9200.1.256.64bit"
                    }
                }
                let req = https.request(options, async res => {
                    res.setEncoding("utf8")
                    let collection = ""
                    res.on("data", async data => {
                        collection = collection + data
                    })
                    res.on("end", async () => {
                        try {
                            let parsed = JSON.parse(collection)
                            if(parsed.code != 200){
                                reject("Unexpected response from Playfab: \ncode:" + parsed.code + "\nstatus: " + parsed.status + "\nerrorCode: " + parsed.errorCode)
                            }else {
                                global._.sessionTicket = parsed.data.SessionTicket
                                //Wait for the server to show up in the registry
                                let timeNow = new Date().getTime()
                                let options3 = {
                                    method: "POST",
                                    hostname: '5EA1.playfabapi.com',
                                    path: '/Client/GetCurrentGames?sdk=UE4MKPL-1.19.190610',
                                    port: 443,
                                    headers: {
                                        "Content-Type": "application/json",
                                        "X-Authorization": global._.sessionTicket,
                                        "User-Agent": "game=Astro, engine=UE4, version=4.18.2-0+++UE4+Release-4.18, platform=Windows, osver=6.2.9200.1.256.64bit"
                                    } 
                                }
                                let req3 = https.request(options3, async (res) => {
                                    res.setEncoding("utf8")
                                    let collection2 = ""
                                    res.on("data", async data => {
                                        collection2 = collection2 + data
                                    })
                                    res.on("end", async () => {
                                        collection2 = JSON.parse(collection2)
                                        if(collection2.code == 200){
                                            if(collection2.data.GameCount == 1){
                                                global._.server = collection2.data.Games[0]
                                                resolve(new Date().getTime() - timeNow)
                                            }else { 
                                                if(collection2.data.GameCount > 1){
                                                    reject("There are currently more than one servers running. Please shutdown all instances of Astroneer Dedicated server (astro.exe) and restart this application.")
                                                }else {
                                                    global._.registratioWaitLoop = setInterval(async () => {
                                                        let options2 = {
                                                            method: "POST",
                                                            hostname: '5EA1.playfabapi.com',
                                                            path: '/Client/GetCurrentGames?sdk=UE4MKPL-1.19.190610',
                                                            port: 443,
                                                            headers: {
                                                                "Content-Type": "application/json",
                                                                "X-Authorization": global._.sessionTicket,
                                                                "User-Agent": "game=Astro, engine=UE4, version=4.18.2-0+++UE4+Release-4.18, platform=Windows, osver=6.2.9200.1.256.64bit"
                                                            } 
                                                        }
                                                        let req2 = https.request(options2, async (res) => {
                                                            res.setEncoding("utf8")
                                                            let collection2 = ""
                                                            res.on("data", async data => {
                                                                collection2 = collection2 + data
                                                            })
                                                            res.on("end", async () => {
                                                                collection2 = JSON.parse(collection2)
                                                                if(collection2.code == 200){
                                                                    if(collection2.data.GameCount == 1){
                                                                        clearInterval(global._.registratioWaitLoop)
                                                                        global._.server = collection2.data.Games[0]
                                                                        resolve(new Date().getTime() - timeNow)
                                                                    }else { 
                                                                        if(collection2.data.GameCount > 1){
                                                                            reject("There are currently more than one servers running. Please shutdown all instances of Astroneer Dedicated server (astro.exe) and restart this application.")
                                                                        }
                                                                    }
                                                                }else {
                                                                    reject("Unexpected response from Playfab: \ncode:" + parsed.code + "\nstatus: " + parsed.status + "\nerrorCode: " + parsed.errorCode)
                                                                }
                                                            })
                                                        })
                                                        req2.write(JSON.stringify({TagFilter: {
                                                            Includes: [
                                                                {Data: {gameId: global.config["Astroneer-Dedicated-Server"].publicIP + ":" + global.config["Astroneer-Dedicated-Server"].port}}
                                                            ]
                                                        }}))
                                                        req2.end()
                                                    }, global.config["AstroManager"].eventFrequency * 1000)
                                                }
                                            }
                                        }else {
                                            reject("Unexpected response from Playfab: \ncode:" + parsed.code + "\nstatus: " + parsed.status + "\nerrorCode: " + parsed.errorCode)
                                        }
                                    })
                                })
                                req3.write(JSON.stringify({TagFilter: {
                                    Includes: [
                                        {Data: {gameId: global.config["Astroneer-Dedicated-Server"].publicIP + ":" + global.config["Astroneer-Dedicated-Server"].port}}
                                    ]
                                }}))
                                req3.end()
                            }   
                        }
                        catch(err){
                            reject(err)
                        }
                    })
                })
                req.write(JSON.stringify({
                    CreateAccount: true,
                    CustomId: global._.serverGuid,
                    TitleId: "5EA1"
                }))
                req.end()
            }
            catch(err){
                reject(err)
            }
        })
    }
})
const mods = new (class Mods {
    async getMods(){
        return new Promise(async (resolve, reject) => {
            try {
                fs.readdir("./mods/", async (err, files) => {
                    if(err != null){
                        reject(err)
                    }else {
                        if(files.length == 0){
                            resolve([[], []])
                        }else {
                            let count = 0
                            let skip = []
                            files.forEach(async file => {
                                let errored = false
                                let id = file.split("-")[1]
                                let prio = file.split("-")[0]
                                let pak = new mod("./mods/" + file)    
                                pak.read().then(async metadata => {
                                    //TODO: Add spec check
                                    //Spec check
                                    metadata = JSON.parse(metadata)
                                    if(
                                    (metadata.name != undefined && typeof metadata.name == "string" && metadata.name.length > 0) && 
                                    (metadata.mod_id != undefined && typeof metadata.mod_id == "string" && metadata.mod_id == id) && 
                                    (metadata.version != undefined && (typeof metadata.version == "string" || typeof metadata.version == "number") && metadata.version.length > 0) && 
                                    (metadata.astro_build != undefined && typeof metadata.astro_build == "string")
                                    ) {
                                        //Mod clear
                                    }
                                    else {
                                        errored = true
                                        cli.log("[WARNING]: Invalid mod suplied. Version check disabled for this plugin: " + file + "\nFailed checks:\n name: " + !(metadata.name != undefined && typeof metadata.name == "string" && metadata.name.length > 0) + "\n mod_id: " + !((metadata.mod_id != undefined && typeof metadata.mod_id == "string" && metadata.mod_id == id)) + "\n version: " + !((metadata.version != undefined && (typeof metadata.version == "string" || typeof metadata.version == "number") && metadata.version.length > 0)) + "\n astro_build: " + !((metadata.astro_build != undefined && typeof metadata.astro_build == "string")), "Yellow")
                                    }
                                    //Continue
                                    metadata.prio = prio
                                    metadata.file = file
                                    let found = false
                                    let count2 = -1
                                    if(global._.mods.length == 0){
                                        //Clear to load
                                        global._.mods.push(JSON.stringify(metadata))
                                        ++count
                                    }else {
                                        global._.mods.forEach(async mod => {
                                            ++count2
                                            mod = JSON.parse(mod)
                                            if(errored == false){
                                                if(mod.mod_id == metadata.mod_id){
                                                    if(mod.prio < metadata.prio){
                                                        found = true
                                                        skip.push(mod.file)
                                                        global._.mods[count2] = JSON.stringify(metadata)
                                                        ++count
                                                    }else {
                                                        found = true
                                                        skip.push(mod.file)
                                                        ++count
                                                    }
                                                }
                                            }
                                            if((count2 + 1) == global._.mods.length && found == false){
                                                //Clear to load
                                                global._.mods.push(JSON.stringify(metadata))
                                                ++count
                                            }
                                        })
                                    }
                                    if(count == files.length){
                                        resolve([global._.mods, skip])
                                    }
                                }).catch(async err => {
                                    reject("Invalid mod suplied: " + file + "\nError: " + err)
                                })
                            })
                        }
                    }
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
    async pushMods(){
        return new Promise(async (resolve, reject) => {
            try {
                fs.readdir("./mods/", async (err, files) => {
                    if(err != null){
                        reject(err)
                    }else {
                        if(fs.existsSync(global.config.AstroManager.path + "\\Astro\\Saved\\Paks")){
                            fs.readdir(global.config.AstroManager.path + "\\Astro\\Saved\\Paks", async (err, files2) => {
                                if(err != null){
                                    reject(err)
                                }else {
                                    if(files != files2){
                                        let count = 0
                                        files.forEach(async file => {
                                            fs.copyFile("./mods/" + file, global.config.AstroManager.path + "\\Astro\\Saved\\Paks\\" + file, async (err) => {
                                                if(err != null){
                                                    reject(err)
                                                }else {
                                                    ++count
                                                    if(count == files.length){
                                                        resolve()
                                                    }
                                                }
                                            })
                                        })
                                    }else {
                                        resolve()
                                    }
                                }
                            })
                        }else {
                            fs.mkdir(global.config.AstroManager.path + "\\Astro\\Saved\\Paks", {recursive: true}, async (err) => {
                                if(err != null){
                                    reject(err)
                                }else {
                                    let count = 0
                                    files.forEach(async file => {
                                        fs.copyFile("./mods/" + file, global.config.AstroManager.path + "\\Astro\\Saved\\Paks\\" + file, async (err) => {
                                            if(err != null){
                                                reject(err)
                                            }else {
                                                ++count
                                                if(count == files.length){
                                                    resolve()
                                                }
                                            }
                                        })
                                    })
                                }
                            })
                        }
                    }
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
})
const forker = class Fork {
    async kill(){
        return new Promise(async (resolve, reject) => {
            try {
                cp.exec("taskkill /pid " + global._.process.pid + " /f /t", async (err) => {
                    if(global._.rconActive == true){
                        resolve()
                    }
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
    async start(){
        return new Promise(async (resolve, reject) => {
            try {
                //Start the server
                async function _start(){
                    async function __start(){
                        //Start the server
                        tools.setTerminalTitle("AstroManager - Starting server...")
                        cli.log("[INFO]: Starting server now...", "Blue", true)
                        let resolved = false
                        tools.writeSettings().then(async () => {
                            if(global._.interrupt) return
                            let args = []
                            if(global.config.AstroManager.ServerConsoleWindow != false) args.push("-log") //Open console on startup or not
                            global._.process = cp.execFile(global.config["AstroManager"].path + "\\AstroServer.exe", args, async (error, stdout, stderr) => {
                                //Currently there is no stdout or stderr
                                if(error != null){
                                    if(resolved == false){
                                        global._.shutdown = true
                                        reject("[ERROR]: Server crashed or detached from AstroManager: \n" + error, "Red")
                                    }else if(global._.interrupt == false){
                                        global._.shutdown = true
                                        cli.log("[ERROR]: Server crashed or detached from AstroManager: \n" + error, "Red")
                                    }
                                }
                            })
                            global._.process.on("exit", async (code) => {
                                if(resolved == false){
                                    cli.log("[ERROR]: Server exited with code: " + code + "\n Reason: " + exitCodes[code], "Red")
                                }else {
                                    if(global._.interrupt == true){
                                        global._.shutdown = true
                                        cli.log("[INFO]: Server shutdown. Closing AstroManager...", "Blue", true)
                                    }else {
                                        cli.log("[INFO]: Server exited with code: " + code + "\n Reason: " + exitCodes[code])
                                        if(code == null) global._.shutdown = true
                                    }
                                    //Restart?
                                }
                            })
                            global._.process.on("disconnect", async () => {
                                if(global._.interrupt == true){
                                    global._.shutdown = true
                                    cli.log("[INFO]: Server shutdown. Closing AstroManager...", "Blue", true)
                                }else {
                                    if(global._.interrupt == false) cli.log("[WARNING]: Server disconnected from AstroLauncher", "Yellow")
                                }
                                //Attempt to shutdown via rcon and restart / kill from console
                            })
                            //Wait for the server to register
                            network.getPlayfabRegistration().then(async (sec) => {
                                if(global._.interrupt) return
                                //Start heartbeat
                                global._.playfabHeartbeat = setInterval(async () => {
                                    network.playfabHeartbeat().then(async () => {
                                        //All good
                                    }).catch(async err => {
                                        cli.log("[ERROR]: Failed to heartbeat to Playfab:\n" + err, "Red")
                                    })
                                }, 30000)
                                //Connect rcon
                                cli.log("[INFO]: Server started (" + (sec * 0.001).toFixed(1) + "s)")
                                async function connect(){
                                    let errored = false
                                    tools.setTerminalTitle("AstroManager - Connecting to server terminal...")
                                    cli.log("[INFO]: Connecting to server terminal...", "Blue", true)
                                    setTimeout(async () => {
                                        global._.rcon = new rcon("127.0.0.1", global.config["Astroneer-Dedicated-Server"].consolePort)
                                        global._.rcon.connect().then(async command => {
                                            global._.command = command
                                            global._.rconActive = true
                                            resolved = true
                                            resolve()
                                        }).catch(async err => {
                                            if(global._.rconActive != true && errored == false){
                                                errored = true
                                                cli.log("[ERROR]: Unable to connect to server terminal. " + err, "Red")
                                                setTimeout(async () => connect(), 2000)
                                            }
                                        })
                                        global._.rcon.events.on("error", async (err) => {
                                            if(global._.rconActive != true && errored == false){
                                                errored = true
                                                cli.log("[ERROR]: Unable to connect to server terminal. " + err, "Red")
                                                setTimeout(async () => connect(), 2000)
                                            }
                                        })
                                        global._.rcon.events.on("close", async () => {
                                            global._.rconActive = false
                                        })
                                        global._.rcon.events.on("playerJoined", async player => {
                                            cli.log("[INFO]: " + player.playerName + " (" + player.playerGuid + ") joined the game!")
                                        })
                                        global._.rcon.events.on("playerLeft", async player => {
                                            cli.log("[INFO]: " + player.playerName + " (" + player.playerGuid + ") left the game.")
                                        })
                                    }, 500)
                                }
                                connect()
                            }).catch(async err => {
                                if(global._.interrupt) return
                                resolved = true
                                cli.log("[ERROR]: Failed to connect to Playfab: " + err, "Red")
                                cli.log("Exiting...", undefined, true)
                                setTimeout(async () => {
                                    process.emit("SIGINT")
                                }, 3000)
                            })
                        }).catch(async err => {
                            if(global._.interrupt) return
                            if(err == null){
                                cli.log("[INFO]: You seem to be missing some config files or this is the first run. We'll create the files for you, please wait.")
                                let server = cp.exec('cd /d "' + global.config["AstroManager"].path + '" && "' + global.config["AstroManager"].path + '\\AstroServer.exe" -log', async (error, stdout, stderr) => {
                                    //Currently there is no stdout or stderr
                                    if(error != null){
                                        cli.log("[ERROR]: Unexpected error occured while trying to do first run: \n" + err + "\n" + err.stack)
                                    }
                                })
                                fs.watch(global.config["AstroManager"].path + "\\Astro\\Saved\\Config\\WindowsServer\\", "utf8", async (event, filename) => {
                                    setTimeout(async () => {
                                        cli.log("[INFO]: The required files should have now been created. We'll restart for you in 3 seconds...", "Green", true)
                                        server.kill()
                                        setTimeout(async () => {
                                            process.stdout.cursorTo(0, 0)
                                            process.stdout.clearScreenDown()
                                            main()
                                        }, 3000)
                                    }, 5000)
                                })
                            }else {
                                reject(err)
                            }
                        })
                    }
                    cli.log("[INFO]: Processing mods...", "Blue", true)
                    if(global.config.Mods.enabled == true){
                        mods.getMods().then(async (response) => {
                            let res = response[0]
                            let skip = response[1]
                            if(skip.length != 0) cli.log("[WARNING]: While loading mods AstroManager found outdated or duplicate mods. Please make sure that these possibly conflicting mods are removed.\nOutdated or duplicate mods(by filename): \n- " + skip.join("\n- "), "Yellow")
                            let names = []
                            let count = 0
                            cli.log("[INFO]: Found " + res.length + " mod" + (res.length == 0 || res.length > 1 ? "s":""))
                            if(res.length == 0){
                                cli.log("[INFO]: No mods to enable.", "Yellow")
                                __start()
                            }else {
                                res.forEach(async mod => {
                                    mod = JSON.parse(mod)
                                    names.push(mod.name + "(" + mod.version + ")")
                                    ++count
                                    if(count == res.length){
                                        cli.log("[INFO]: Enabling mods: " + names.join(", "), "Blue", true)
                                        mods.pushMods().then(async () => {
                                            cli.log("[INFO]: Mods enabled!", "Green")
                                            __start()
                                        }).catch(async err => {
                                            reject(err + "")
                                        })
                                    }
                                })
                            }
                        }).catch(async err => {
                            reject(err + "")
                        })
                    }else {
                        cli.log("[INFO]: Mods disabled", "Yellow")
                        __start()
                    }
                }
                //Checks before launch
                //Welcome message 
                tools.welcomeMessage().then(async () => {
                    //Get system configuration
                    tools.getSystemData().then(async system => {
                        global._.system = system
                        if(global.config["AstroManager"].path  == undefined || global.config["AstroManager"].path  == ""){
                            cli.wait = true
                            cli.log("[INFO]: It looks like you have not yet set your server installation path in the config, would you like us to autodetect the installation path? (y/n + enter)\n")
                            cli.events.once("pick", async res => {
                                cli.wait = false
                                if(res == false){
                                    cli.log("[INFO]: User terminated path autodetection. Please restart or set the path manually in the config.", "Red", true)
                                    setTimeout(async () => {
                                        process.exit()
                                    }, 3000)
                                }else {
                                    tools.getInstallPath(system.arch == "64" ? true : false).then(async paths => {
                                        let index = -1
                                        async function setPath(){
                                            ++index
                                            cli.log("[INFO]: Autodetection found this" + (index != 0 ? " other " : " ") + "installation path. Is this correct? (y/n + enter)\n" + paths[index].value + "\n")
                                            cli.wait = true
                                            cli.events.once("pick", async res => {
                                                cli.wait = false
                                                if(res == false){
                                                    if(paths[index + 1] == undefined){
                                                        cli.log("[INFO]: Autodetection was unable to find any other installation paths. Please restart or set the path manually in the config. Exiting.", "Red", true)
                                                        setTimeout(async () => {
                                                            process.exit()
                                                        }, 3000)
                                                    }
                                                }else {
                                                    cli.log("[INFO]: Saving path...", "Green", true)
                                                    tools.set("AstroManager", "path", paths[index].value).then(async () => {
                                                        cli.log("[INFO]: Valid installation path provided. Getting ready to start the server...", "Green", true)
                                                        _start()
                                                    }).catch(async err => {
                                                        cli.log("[ERROR]: Failed to save new value:\n" + err + "\nExiting...", true)
                                                        setTimeout(async () => {
                                                            process.exit()
                                                        }, 3000)
                                                    })
                                                }
                                            })
                                        }
                                        if(paths == undefined || typeof paths != "object" || paths.length == 0){
                                            cli.log("[WARNING]: Autodetection failed to find any installations of Astroneer Dedicated server. Please install it via steam. If this is an error, please specify the path manually in the config.")
                                        }else {
                                            setPath()
                                        }
                                    }).catch(async err => {
                                        reject(err)
                                    })
                                }
                            })
                        }else {
                            if(fs.existsSync(global.config["AstroManager"].path)){
                                cli.log("[INFO]: Valid installation path provided. Getting ready to start the server...", "Green", true)
                                _start()
                            }else {
                                cli.log("[INFO]: The provided installation path in the config is invalid. You can leave the path field empty and restart for path autodetection to run. Exiting.")
                                setTimeout(async () => {
                                    process.exit()
                                }, 3000)
                            }
                        }
                    }).catch(async err => {
                        cli.log("[ERROR]: An unexpected error occured: ")
                        tools.set("AstroManager", "systeminternalsEula", false).then(async () => {
                            cli.log("[ERROR]: Reset sysinternals eula setting. Please restart", "Yellow")
                            console.log("\n", err, "\n")
                            reject(err)
                        }).catch(async err2 => {
                            reject(err2)
                        })
                    })
                }).catch(async err => {
                    cli.log("[ERROR]: Cannot display title: " + err + "\n" + err.stack)
                })
            }
            catch(err){
                reject(err)
            }
        })
    }
    async stop(){
        async function _stop(){
            try {
                if(global._.process.killed == false){
                    if(global.tries > 10){
                        ++global.tries
                        cli.log("[INFO]: Forcing to shutdown the server...", "Blue", true)
                        global.restart = false
                        global._.session.kill()
                        if(global.tries > 11){
                            process.abort()
                        }
                    }else {
                        ++tries
                        if(global._.rconActive == true){
                            cli.log("[INFO]: Trying to save game...", "Blue", true)
                            let responded = false
                            let tm = setTimeout(async () => {
                                if(responded == false){
                                    cli.log("[INFO]: Server did not respond in time. Shutting down...", "Blue", true)
                                    global.restart = false
                                    global._.session.kill()
                                }
                            }, 10000)
                            global._.command.save().then(async () => {
                                responded = true
                                clearTimeout(tm)
                                cli.log("[INFO]: Saved game. Shutting down...", "Blue", true)
                                global._.session.kill()
                            }).catch(async err => {
                                cli.log("[ERROR]: " + err)
                                setTimeout(async () => _stop(), 1000)
                            })
                        }else {
                            cli.log("[INFO]: Cannot save. Shutting down...", "Blue", true)
                            global.restart = false
                            global._.session.kill()
                        }
                    }
                }else {
                    process.exit()
                }
            }
            catch(err){
                cli.log("[ERROR]: " + err, "Red")
                setTimeout(async () => _stop(), 1000)
            }
        }
        let e = setInterval(async () => {
            if(global._.shutdown == true){
                clearInterval(e)
                cli.log("[INFO]: Execution ended.")
                if(global.restart == false){
                    process.exit()
                }else {
                    this.kill().then(async () => {
                        global._.rcon.close().then(async () => {
                            define()
                            main()
                        }).catch(async err => {
                            cli.log("[ERROR]: " + err, "Red")
                        })
                    }).catch(async err => {
                        cli.log("[ERROR]: " + err, "Red")
                    })
                }
            }
        }, 5000)
        _stop()
    }
}

/* Code */
async function main(){
    async function main2(){
        let session = new forker()
        global._.session = session
        global._.session.start().then(async () => {
            tools.setTerminalTitle("AstroManager - Dedicated server online")
            cli.log("[INFO]: Astroneer dedicated server online. You may now execute commands in this console (see 'help' command).")
        }).catch(async err => {
            cli.log(err)
            cli.log("\nIt seems something went wrong with the server. Please make sure the server is not running and then restart AstroManager.", "Red", false)
            cli.log("Exiting in 5 seconds...", undefined, true)
            setTimeout(async () => {
                process.exit()
            }, 5000)
        })
    }
    if(global.config["AstroManager"].systeminternalsEula == false){
        tools.acceptSysinternalsEula().then(async () => {
            tools.set("AstroManager", "systeminternalsEula", true).then(async () => {
                main2()
            }).catch(async err => {
                cli.log("[ERROR]: " + err)
            })
        }).catch(async err => {
            cli.log("[ERROR]: " + err)
        })
    }else {
        main2()
    }
}

process.on("SIGINT", async () => {
    global._.interrupt = true
    tools.setTerminalTitle("AstroManager - Shutdown in progress")
    if(global._.process == null) return;
    if(Object.keys(global._.server).length == 0){ //Server has not started
        cli.log("[INFO]: Start interupted!")
        global._.session.stop()
        setInterval(async () => {
            if(global._.shutdown == true){
                if(global.restart == false){
                    process.exit()
                }else {
                    global._.rcon.close().then(async () => {
                        define()
                        main()
                    }).catch(async err => {
                        cli.log("[ERROR]: " + err, "Red")
                    })
                }
            }
        }, 2500)
    }else {
        cli.log("[INFO]: Starting to shutdown...")
        global._.session.stop()
    }
})
/* Files and config */
async function files(){
    let verified = 0
    /* Config */
    if(fs.existsSync("./config.json")){
        global.config = require("./config.json")
        ++verified
    }else {
        fs.writeFile("./config.json", JSON.stringify({
            "AstroManager": {
                "path": "",
                "eventFrequency": 5,
                "systeminternalsEula": false,
                "ServerConsoleWindow": false
            },
            "SaveManagement": {
                
            },
            "ServerRegistry": {
                "enabled": false,
                "name": "Another Astroneer Server",
                "type": "AstroManagerJS v1.0.0"
            },
            "Network": {
                "enabled": false,
                "configureFirewall": true,
                "checkSecurity": true
            },
            "Mods": {
                "enabled": false
            },
            "Astroneer-Dedicated-Server": {
                "port": "8777",
                "consolePort": "1234",
                "maxPlayers": "8",
                "loadAutosave": true,
                "maxFramerate": 60,
                "maxIdleFramerate": 3,
                "waitForPlayersBeforeShutdown": false,
                "publicIP": "91.155.29.141",
                "serverName": "",
                "ownerName": "",
                "ownerGuid": 0,
                "playerIdleTimeout": 0,
                "autosaveInterval": 900,
                "backupInterval": 7200,
                "savegame": "SAVE_1",
                "clientRatelimit": 1000000,
                "internetClientRatelimit": 1000000
            }
        }), (err) => {
            if(err != null){
                cli.log("[ERROR]", "Red")
                console.log("\n", err, "\n")
                process.exit()
            }else {
                ++verified
                global.config = require("./config.json")
                cli.log("[WARNING]: New config created", "Yellow")
            }
        })
    }
    /* Create dirs and files */
    if(!fs.existsSync("./mods")){
        fs.mkdir("./mods/", (err) => {
            if(err != null){
                cli.log("[ERROR]", "Red")
                console.log("\n", err, "\n")
                process.exit()
            }else {
                ++verified
            }
        })
    }else {
        ++verified
    }
    if(!fs.existsSync("./bin")){
        fs.mkdir("./bin", (err) => {
            if(err != null){
                cli.log("[ERROR]", "Red")
                console.log("\n", err, "\n")
                process.exit()
            }else {
                ++verified
                try {
                    cli.log("Downloading binaries...")
                    let file = fs.createWriteStream("./bin/build.zip");
                    let request = http.get("http://esinko.net/downloads/astromanager/build.zip", function(response) {
                        response.pipe(file);
                        file.on("close", async () => {
                            cli.log("Unpacking binaries...")
                            extract("./bin/build.zip", { dir: process.cwd() + "/bin/"}).then(async () => {
                                await fs.unlinkSync("./bin/build.zip")
                                cli.log("Unpacked!")
                                global.regedit = require("./bin/build/regedit")
                                ++verified
                                if(!fs.existsSync("./bin/SysInternalsEula.bat")){
                                    fs.writeFile("./bin/SysInternalsEula.bat", '@echo off\nstart "" /b /wait cmd /c ""./bin/build/ps/psinfo.exe"" > ./bin/eula.txt && exit', async (err) => {
                                        if(err != null){
                                            cli.log("[ERROR]", "Red")
                                            console.log("\n", err, "\n")
                                            process.exit()
                                        }else {
                                            ++verified
                                        }
                                    })
                                }else {
                                    ++verified
                                }
                            }).catch(async err => {
                                cli.log("[ERROR]", "Red")
                                console.log("\n", err, "\n")
                                process.exit()
                            })
                        })
                    });
                }
                catch(err){
                    cli.log("[ERROR]", "Red")
                    console.log("\n", err, "\n")
                    process.exit()
                }
            }
        })
    }else {
        ++verified
        if(!fs.existsSync("./bin/build")){
            try {
                cli.log("Downloading binaries...")
                let file = fs.createWriteStream("./bin/build.zip");
                let request = http.get("http://esinko.net/downloads/astromanager/build.zip", function(response) {
                    response.pipe(file);
                    file.on("close", async () => {
                        cli.log("Unpacking binaries...")
                        extract("./bin/build.zip", { dir: process.cwd() + "/bin/"}).then(async () => {
                            await fs.unlinkSync("./bin/build.zip")
                            cli.log("Unpacked!")
                            global.regedit = require("./bin/build/regedit")
                            ++verified
                            if(!fs.existsSync("./bin/SysInternalsEula.bat")){
                                fs.writeFile("./bin/SysInternalsEula.bat", '@echo off\nstart "" /b /wait cmd /c ""./bin/build/ps/psinfo.exe"" > ./bin/eula.txt && exit', async (err) => {
                                    if(err != null){
                                        cli.log("[ERROR]", "Red")
                                        console.log("\n", err, "\n")
                                        process.exit()
                                    }else {
                                        ++verified
                                    }
                                })
                            }else {
                                ++verified
                            }
                        }).catch(async err => {
                            cli.log("[ERROR]", "Red")
                            console.log("\n", err, "\n")
                            process.exit()
                        })
                    })
                });
            }
            catch(err){
                cli.log("[ERROR]", "Red")
                console.log("\n", err, "\n")
                process.exit()
            }
        }else {
            ++verified
            if(!fs.existsSync("./bin/SysInternalsEula.bat")){
                fs.writeFile("./bin/SysInternalsEula.bat", '@echo off\nstart "" /b /wait cmd /c ""./bin/build/ps/psinfo.exe"" > ./bin/eula.txt && exit', async (err) => {
                    if(err != null){
                        cli.log("[ERROR]", "Red")
                        console.log("\n", err, "\n")
                        process.exit()
                    }else {
                        ++verified
                    }
                })
            }else {
                ++verified
            }
        }
    }
    let i = setInterval(async () => {
        if(verified == 5){
            clearInterval(i)
            main()
        }
    }, 500)
}
tools.setTerminalTitle("Loading...")
files()