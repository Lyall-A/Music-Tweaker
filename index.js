const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const debug = false;

// Get args
const processArgs = process.argv.slice(2);
const argOptions = [
    { short: ["h"], long: ["help"], description: "This", bool: true },
    { short: ["i"], long: ["input"], description: "Input file", required: true },
    { short: ["fm"], long: ["ffmpeg"], description: "FFmpeg path", default: "/bin/ffmpeg" },
    { short: ["fp"], long: ["ffprobe"], description: "FFprobe path", default: "/bin/ffprobe" },
    { short: ["nc"], long: ["nightcore", "speed", "spedup"], description: "Speed up song", bool: true },
    { long: ["slowed"], description: "Slow down song", bool: true },
    { long: ["reverse"], description: "Reverse audio", bool: true },
    { name: "noiseReduction", long: ["noise_reduction"], description: "Noise reduction", bool: true },
    { long: ["flanger"], description: "Add flanger effect", bool: true },
    { long: ["phaser"], description: "Add phaser effect", bool: true },
    { long: ["pitch"], description: "Pitch multiplier, doesn't change speed" },
    { long: ["bass"], description: "Bass boost" },
    { long: ["tempo"], description: "Tempo" },
    { long: ["pulsate"], description: "Pulsate" },
    { name: "audioFilters", short: ["af"], long: ["audio_filters"], description: "Add more audio filters" },
    { short: ["hp"], long: ["highpass"], description: "High-pass" },
    { short: ["lp"], long: ["lowpass"], description: "Low-pass" },
    { short: ["v", "vol"], long: ["volume"], description: "Change volume" },
    { short: ["b:a"], long: ["bitrate"], description: "Bitrate" },
    { short: ["p"], long: ["preset"], description: "Preset" },
    { short: ["c:a"], long: ["codec"], description: "Output codec" },
    { short: ["f"], long: ["format"], description: "Output format" },
    { short: ["o"], long: ["output"], description: "Output path" },

    // for fucked up stuff idk (TODO: create presets)
    // { name: "nightcore", default: true },
    // { name: "bitrate", default: "32k" },
    // { name: "bitrate", default: "64k" },
    // { name: "bitrate", default: "128k" },
    // { name: "format", default: "mp3" },
    // { name: "bass", default: "10" },
    // { name: "bass", default: "5" },
    // { name: "volume", default: "200" },
];
for (const options of argOptions) {
    const keyIndex = processArgs.findIndex(arg => {
        const isKey = /^--?.+/.test(arg);
        if (!isKey) return false;
        const shortMatch = arg.match(/^-([^-].*)/);
        const longMatch = arg.match(/^--(.*)/);
        if (options.short?.includes(shortMatch?.[1]) || options.long?.includes(longMatch?.[1])) return true;
    });
    if (keyIndex === -1) {
        options.value = options.default || null;
    } else {
        if (options.bool) {
            options.value = true;
        } else {
            options.value = !/^--?.+/.test(processArgs[keyIndex + 1]) ? processArgs[keyIndex + 1] || null : options.default || null;
        }
    }
    if (options.long === "help" && options.value) return displayHelp();
    if (options.required && options.value === null) return displayHelp();
};
const cliArgs = Object.fromEntries(argOptions.map(i => ([i.name || i.long?.[0] || i.short?.[0], i.value])));

debugLog("cliArgs:", cliArgs);

const presets = require("./presets.json");
const preset = cliArgs.preset ? presets.find(i => i.id === cliArgs.preset || i.name === cliArgs.preset) : null;

if (cliArgs.preset && !preset) return console.log(`Couldn't find preset '${cliArgs.preset}!`);

// idk just functions to make things easier
const getSampleRate = (ffprobeInfo) => parseInt(ffprobeInfo.streams[0].sample_rate);
const getFormat = (ffprobeInfo) => ffprobeInfo.format.format_name;

// main
(async function main() {
    const inputPath = getOption("input");
    const inputExtName = path.extname(inputPath).substring(1);

    if (!fs.existsSync(inputPath)) return console.log(`Input file '${inputPath}' doesn't exist`);
    const ffprobeInfo = await ffprobe(inputPath);
    const sampleRate = getSampleRate(ffprobeInfo);
    const formats = getFormat(ffprobeInfo).split(",");

    const outputFormat = getOption("format") || (formats.length ? formats.includes(inputExtName) ? inputExtName : formats[0] : formats[0]); // ffprobe can return multiple formats, look for file format or use the first one
    const outputPath = getOption("output") || path.join(__dirname, `${path.basename(inputPath, `.${inputExtName}`)}.${outputFormat}`);
    const audioFilters = [];
    const args = [];

    // audio filters
    if (getOption("pitch")) audioFilters.push(`asetrate=${sampleRate}*${getOption("pitch")}`);
    if (getOption("volume")) audioFilters.push(`volume=${getOption("volume") / 100}`);
    if (getOption("nightcore")) audioFilters.push(`asetrate=${sampleRate}*1.25,aresample=${sampleRate}`);
    if (getOption("slowed")) audioFilters.push(`asetrate=${sampleRate}*0.9`);
    if (getOption("bass")) audioFilters.push(`bass=g=${getOption("bass")}`);
    if (getOption("tempo")) audioFilters.push(`atempo=${getOption("tempo")}`);
    if (getOption("reverse")) audioFilters.push(`areverse`);
    if (getOption("highpass")) audioFilters.push(`highpass=f=${getOption("highpass")}`);
    if (getOption("lowpass")) audioFilters.push(`lowpass=f=${getOption("lowpass")}`);
    if (getOption("pulsate")) audioFilters.push(`apulsator=hz=${getOption("pulsate")}`);
    if (getOption("noiseReduction")) audioFilters.push(`afftdn`);
    if (getOption("flanger")) audioFilters.push(`flanger`);
    if (getOption("phaser")) audioFilters.push(`aphaser`);
    if (getOption("audioFilters")) audioFilters.push(getOption("audioFilters"));

    // other args
    if (audioFilters.length) args.push("-af", audioFilters.join(","));
    if (getOption("bitrate")) args.push("-b:a", getOption("bitrate"));
    if (getOption("codec")) args.push("-c:a", getOption("codec"));
    args.push("-f", outputFormat); // format is needed since outputting to pipe

    console.log(`Using FFmpeg args '${args.join(" ")}'`);

    const output = await ffmpeg(inputPath, args);
    fs.writeFileSync(outputPath, output.data);

    console.log(`Finished! Saved at '${outputPath}'`);

    // ffmpeg(outputPath, ["-f", "pulse"]); // play to pulse output (testing)
})();

function getOption(key) {
    return cliArgs[key] || preset?.options[key];
}

// run ffmpeg
function ffmpeg(input = "-", args = [], output = "-") {
    args = ["-i", input, ...args, output].filter((value, index, array) => array.indexOf(value) === index);
    debugLog(`Attemping to spawn FFmpeg instance with args '${args.join(" ")}'`);
    const ffmpegProcess = cp.spawn(getOption("ffmpeg"), args);
    const dataArray = [];
    const logArray = [];
    const promise = new Promise((resolve, reject) => {
        ffmpegProcess.stdout.on("data", i => dataArray.push(i));
        ffmpegProcess.stderr.on("data", i => logArray.push(i));
        ffmpegProcess.on("exit", code => {
            debugLog(`FFmpeg instance exited with code ${code}`);
            const data = Buffer.concat(dataArray);
            const log = Buffer.concat(logArray).toString();
            if (code > 0) return reject(`FFmpeg exited with code ${code}: ${log}`);
            return resolve({ data, log, code });
        });
    });
    promise.stdin = ffmpegProcess.stdin;
    promise.stdout = ffmpegProcess.stdout;
    promise.stderr = ffmpegProcess.stderr;
    return promise;
}

// run ffprobe
function ffprobe(input = "-", args = []) {
    args = ["-i", input, ...args, "-print_format", "json", "-show_format", "-show_streams"];
    debugLog(`Attemping to spawn FFprobe instance with args '${args.join(" ")}'`);
    const ffprobeProcess = cp.spawn(getOption("ffprobe"), args);
    const dataArray = [];
    const promise = new Promise((resolve, reject) => {
        ffprobeProcess.stdout.on("data", i => dataArray.push(i));
        ffprobeProcess.on("exit", code => {
            debugLog(`FFprobe instance exited with code ${code}`);
            const data = Buffer.concat(dataArray);
            if (code > 0) return reject(`FFprobe exited with code ${code}`);
            try {
                const json = JSON.parse(data);
                resolve(json);
            } catch (err) {
                reject(`Failed to parse JSON: ${data}`);
            }
        });
    });
    promise.stdin = ffprobeProcess.stdin;
    promise.stdout = ffprobeProcess.stdout;
    promise.stderr = ffprobeProcess.stderr;
    return promise;
}

function debugLog(...msgs) {
    if (!debug) return;
    console.log("[DEBUG]", ...msgs);
}

function displayHelp() {
    return console.log(argOptions.map(i => `${i.short ? `${i.short.map(i => `-${i}`).join(" ")} ` : ""}${i.long ? `${i.long.map(i => `--${i}`).join(" ")} ` : ""}- ${i.description}`).join("\n"));
}