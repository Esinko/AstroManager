const zlib = require("zlib")
let compression = ["NONE", "ZLIB", "BIAS_MEMORY", "BIAS_SPEED"]
const struct = require('python-struct');
module.exports = class Mod {
    constructor(filepath){
        this.filepath = filepath
    }
    async read(){
        return new Promise(async (resolve, reject) => {
            try {
                let fs = require("fs")
                if(fs.existsSync(this.filepath)){
                    fs.readFile(this.filepath, async (err, data) => {
                        if(err != null){
                            reject(err)
                        }else {
                            let bytes = Uint32Array.from(data).reverse()
                            let offset = Uint32Array.from(data)
                            let footer = [] //Not the footer most of the time. Used as a single memory variable!
                            for(let i = 0;i < 44;i++){footer.push(bytes[i])}
                            footer = footer.reverse()
                            async function read(type, data){
                                let rton = struct.unpack(type, new Buffer.from(type == "<I" ? [data[0], data[1], data[2], data[3]] : [data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]]))
                                switch (type){
                                    case "<I":
                                        data.splice(0, 4)
                                        break
                                    case "<Q":
                                        data.splice(0, 8)
                                        break
                                    case "<B":
                                        data.splice(0, 1)
                                        break
                                    default:
                                        reject("Unkown struct size type")
                                        break
                                }
                                footer = data
                                return rton.toString()
                            }
                            async function readLen(lenght, data, noString){
                                let rtnData = noString ? new Buffer.from(data.splice(0, lenght), "binary") : new Buffer.from(data.splice(0, lenght), "binary").toString()
                                footer = data
                                return rtnData
                            }
                            async function readRec(data, version, header){
                                let filename = null
                                let strLen = null
                                if(header){
                                    strLen = await read("<I", data)
                                    filename = await readLen(strLen, footer)
                                }
                                let offset = await read("<Q", header ? footer : data)
                                let filesize = await read("<Q", footer)
                                let sizedecompressed = await read("<Q", footer)
                                let compressionmethod = await read("<I", footer)
                                if(version <= 1){
                                    let timestamp = await read("<Q", footer)
                                }
                                let hash = await readLen(20, footer)
                                let blocksList = []
                                let encrypted = null
                                let compressionblocksize = null
                                if(fileVersion >= 3){
                                    if(compressionmethod != 0){
                                        let blocks = await read("<I", footer)
                                        for(let i3 = 0;i3 < blocks;i3++){
                                            let sOffset = await read("<Q", footer)
                                            let eOffset = await read("<Q", footer)
                                            blocksList.push({start: sOffset, size: eOffset - sOffset})
                                        }
                                    }
                                    encrypted = await read("<B", footer) != 0
                                    compressionblocksize = await read("<I", footer)
                                }
                                return {
                                    filename: filename,
                                    offset: offset,
                                    compressionmethod: compressionmethod,
                                    filesize: filesize,
                                    data: footer,
                                    blocks: blocksList,
                                    hash: hash,
                                    sizedecompressed: sizedecompressed,
                                    encrypted: encrypted,
                                    compressionblocksize: compressionblocksize
                                }
                            }
                            let rtn = await read("<I", footer)
                            let fileVersion = await read("<I", footer)
                            let indexOffset = await read("<Q", footer)
                            let indexSize = await read("<Q", footer)
                            let _offsetData = Uint32Array.from(data).slice(indexOffset, Uint32Array.from(data).length)
                            footer = []
                            for(let i = 0;i < _offsetData.length;i++){footer.push(_offsetData[i])}
                            let strlen = await read("<I", footer)
                            let mountPoint = await readLen(strlen, footer)
                            let recordCount = await read("<I", footer)
                            let compression2 = 0
                            for(let i = 0;i < recordCount;i++){
                                let _data = await readRec(footer, fileVersion, true)
                                if(_data.compressionmethod != 0) compression2 = _data.compressionmethod
                                if(_data.encrypted == true) reject("Cannot read encrypted .pak files")
                                if(_data.filename.includes("metadata.json")){
                                    let tmp = []
                                    for(let i2 = 0;i2 < offset.length;i2++){if(i2 >= _data.offset) tmp.push(offset[i2])}
                                    let _data2 = await readRec(tmp, fileVersion, false)
                                    switch(compression[compression2]){
                                        case "NONE":
                                            resolve(await readLen(_data2.filesize, _data2.data))
                                            break
                                        case "ZLIB":
                                            let decompressed = []
                                            let count = 0
                                            _data2.blocks.forEach(async block => {
                                                let rData = []
                                                for(let i4 = 0;i4 < offset.length;i4++){if(i4 >= block.start) rData.push(offset[i4])}
                                                let _stream = await readLen(block.size, rData, true)
                                                decompressed.push(zlib.inflateSync(_stream))
                                                ++count
                                                if(count == _data2.blocks.length){
                                                    decompressed = new Uint32Array(decompressed[0])
                                                    let nn = []
                                                    for(let i5 = 0;i5 < decompressed.length;i5++){nn.push(decompressed[i5])}
                                                    resolve(await readLen(nn.length, nn))
                                                }
                                            })
                                            break
                                        default:
                                            reject("Unkown compression method")
                                            break
                                    }
                                }
                            }
                        }
                    })
                }else {
                    reject("Filepath does not exist")
                }
            }
            catch(err){
                reject(err)
            }
        })
    }
}
