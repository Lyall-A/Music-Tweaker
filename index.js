const cp = require("child_process");
const fs = require("fs");
const path = require("path");

// Get args
const processArgs = process.argv.slice(2);
const argOptions = [
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
    { long: ["pulsate"], description: "Pulsate" },
    { name: "audioFilters", short: ["af"], long: ["audio_filters"], description: "Add more audio filters" },
    { short: ["hp"], long: ["highpass"], description: "High-pass" },
    { short: ["lp"], long: ["lowpass"], description: "Low-pass" },
    { short: ["v", "vol"], long: ["volume"], description: "Change volume" },
    { short: ["b:a"], long: ["bitrate"], description: "Bitrate" },
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
    if (options.required && options.value === null) return console.log(`Missing argument '${options.long}'!`);
};
const cliArgs = Object.fromEntries(argOptions.map(i => ([i.name || i.long?.[0] || i.short?.[0], i.value])));

// idk just functions to make things easier
const getSampleRate = (input) => ffprobe(input).then(i => parseInt(i.streams[0].sample_rate));
const getFormat = (input) => ffprobe(input).then(i => i.format.format_name);

// main
(async function main() {
    const inputPath = cliArgs.input;
    const inputExtName = path.extname(inputPath).substring(1);

    if (!fs.existsSync(inputPath)) return console.log(`Input file '${inputPath}' doesn't exist`);
    const sampleRate = await getSampleRate(inputPath);
    const formats = await getFormat(inputPath).then(i => i.split(","))
    
    const outputFormat = cliArgs.format || (formats.length ? formats.includes(inputExtName) ? inputExtName : formats[0] : formats[0]); // ffprobe can return multiple formats, look for file format or use the first one
    const outputPath = cliArgs.output || path.join(__dirname, `${path.basename(inputPath, `.${inputExtName}`)}.${outputFormat}`);
    const audioFilters = [];
    const args = [];

    // audio filters
    if (cliArgs.pitch) audioFilters.push(`asetrate=${sampleRate}*${cliArgs.pitch}`);
    if (cliArgs.volume) audioFilters.push(`volume=${cliArgs.volume / 100}`);
    if (cliArgs.nightcore) audioFilters.push(`asetrate=${sampleRate}*1.25,aresample=${sampleRate}`);
    if (cliArgs.slowed) audioFilters.push(`asetrate=${sampleRate}*0.9`);
    if (cliArgs.bass) audioFilters.push(`bass=g=${cliArgs.bass}`);
    if (cliArgs.reverse) audioFilters.push(`areverse`);
    if (cliArgs.highpass) audioFilters.push(`highpass=f=${cliArgs.highpass}`);
    if (cliArgs.lowpass) audioFilters.push(`lowpass=f=${cliArgs.lowpass}`);
    if (cliArgs.pulsate) audioFilters.push(`apulsator=hz=${cliArgs.pulsate}`);
    if (cliArgs.noiseReduction) audioFilters.push(`afftdn`);
    if (cliArgs.flanger) audioFilters.push(`flanger`);
    if (cliArgs.phaser) audioFilters.push(`aphaser`);
    if (cliArgs.audioFilters) audioFilters.push(cliArgs.audioFilters);
    
    // other args
    if (audioFilters.length) args.push("-af", audioFilters.join(","));
    if (cliArgs.bitrate) args.push("-b:a", cliArgs.bitrate);
    if (cliArgs.codec) args.push("-c:a", cliArgs.codec);
    args.push("-f", outputFormat); // format is needed since outputting to pipe

    console.log(`Using FFmpeg args '${args.join(" ")}'`);

    const output = await ffmpeg(inputPath, args);
    fs.writeFileSync(outputPath, output.outputData);

    console.log(`Finished! Saved at '${outputPath}'`);

    ffplay(outputPath, ["-autoexit"]); // funny testing
})();

// run ffmpeg
function ffmpeg(input, args = [], inputBuffer) {
    args = ["-i", inputBuffer ? "-" : input, ...args, "-"].filter((value, index, array) => array.indexOf(value) === index);
    return new Promise((resolve, reject) => {
        const ffmpegProcess = cp.spawn(cliArgs.ffmpeg, args);
        if (inputBuffer) ffmpegProcess.stdin.write(inputBuffer);
        const data = [];
        const logData = [];
        ffmpegProcess.stdout.on("data", i => data.push(i));
        ffmpegProcess.stderr.on("data", i => logData.push(i));
        ffmpegProcess.on("exit", code => {
            const outputData = Buffer.concat(data);
            const log = Buffer.concat(logData).toString();
            if (code > 0) return reject(`FFmpeg exited with code ${code}: ${log}`);
            return resolve({ outputData, log });
        });
    });
}

// run ffprobe
function ffprobe(input, args = [], inputBuffer) {
    args = ["-i", inputBuffer ? "-" : input, ...args, "-print_format", "json", "-show_format", "-show_streams"].filter((value, index, array) => array.indexOf(value) === index);
    return new Promise((resolve, reject) => {
        const ffprobeProcess = cp.spawn(cliArgs.ffprobe, args);
        if (inputBuffer) ffprobeProcess.stdin.write(inputBuffer);
        const data = [];
        ffprobeProcess.stdout.on("data", i => data.push(i));
        ffprobeProcess.on("exit", code => {
            if (code > 0) return reject(`FFprobe exited with code ${code}`);
            try {
                const json = JSON.parse(Buffer.concat(data));
                resolve(json);
            } catch (err) {
                reject("Failed to parse JSON");
            }
        });
    });
}

// run ffplay (for testing)
function ffplay(input, args = [], inputBuffer) {
    args = ["-i", inputBuffer ? "-" : input, ...args].filter((value, index, array) => array.indexOf(value) === index);
    return new Promise((resolve, reject) => {
        const ffplayProcess = cp.spawn("/bin/ffplay", args, { detached: true, stdio: "ignore" });
        if (inputBuffer) ffprobeProcess.stdin.write(inputBuffer);
        // ffplayProcess.stderr.on("data", i => process.stdout.write(i));
        ffplayProcess.on("exit", code => {
            if (code > 0) return reject(`FFplay exited with code ${code}`);
            resolve();
        });
    });
}