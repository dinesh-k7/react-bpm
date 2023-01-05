(() => {
  // src/consts.ts
  var realtimeBpmProcessorName = "realtime-bpm-processor";
  var startThreshold = 0.95;
  var minValidThreshold = 0.3;
  var thresholdStep = 0.05;

  // src/utils.ts
  function descendingOverThresholds(onLoop, minValidThreshold2 = 0.3) {
    let threshold = startThreshold;
    const object = {};
    do {
      let stop = false;
      threshold -= thresholdStep;
      onLoop(threshold, (bool) => {
        stop = bool;
      });
      if (stop) {
        break;
      }
    } while (threshold > minValidThreshold2);
    return object;
  }
  function generateValidPeaksModel() {
    const object = {};
    let threshold = startThreshold;
    do {
      threshold -= thresholdStep;
      object[threshold.toString()] = [];
    } while (threshold > minValidThreshold);
    return object;
  }
  function generateNextIndexPeaksModel() {
    const object = {};
    let threshold = startThreshold;
    do {
      threshold -= thresholdStep;
      object[threshold.toString()] = 0;
    } while (threshold > minValidThreshold);
    return object;
  }

  // src/analyzer.ts
  function findPeaksAtThreshold(data, threshold, offset) {
    const peaks = [];
    const { length } = data;
    for (let i = offset; i < length; i += 1) {
      if (data[i] > threshold) {
        peaks.push(i);
        i += 1e4;
      }
    }
    return {
      peaks,
      threshold
    };
  }
  function computeBpm(data, audioSampleRate) {
    const minPeaks = 15;
    let hasPeaks = false;
    let foundThreshold = 0.3;
    descendingOverThresholds((threshold, stop) => {
      if (hasPeaks && stop) {
        stop(true);
        return;
      }
      if (data[threshold].length > minPeaks) {
        hasPeaks = true;
        foundThreshold = threshold;
      }
    });
    if (hasPeaks && foundThreshold) {
      const intervals = identifyIntervals(data[foundThreshold]);
      const tempos = groupByTempo(audioSampleRate, intervals);
      const candidates = getTopCandidates(tempos);
      const bpmCandidates = {
        bpm: candidates,
        threshold: foundThreshold
      };
      return bpmCandidates;
    }
    if (!hasPeaks) {
      console.warn(new Error("Could not find enough samples for a reliable detection."));
    }
    return {
      bpm: [],
      threshold: foundThreshold
    };
  }
  function getTopCandidates(candidates, length = 5) {
    return candidates.sort((a, b) => b.count - a.count).splice(0, length);
  }
  function identifyIntervals(peaks) {
    const intervals = [];
    for (let n = 0; n < peaks.length; n++) {
      for (let i = 0; i < 10; i++) {
        const peak = peaks[n];
        const peakIndex = n + i;
        const interval = peaks[peakIndex] - peak;
        const foundInterval = intervals.some((intervalCount) => {
          if (intervalCount.interval === interval) {
            intervalCount.count += 1;
            return intervalCount.count;
          }
          return false;
        });
        if (!foundInterval) {
          const item = {
            interval,
            count: 1
          };
          intervals.push(item);
        }
      }
    }
    return intervals;
  }
  function groupByTempo(audioSampleRate, intervalCounts) {
    const tempoCounts = [];
    for (const intervalCount of intervalCounts) {
      if (intervalCount.interval === 0) {
        continue;
      }
      intervalCount.interval = Math.abs(intervalCount.interval);
      let theoreticalTempo = 60 / (intervalCount.interval / audioSampleRate);
      while (theoreticalTempo < 90) {
        theoreticalTempo *= 2;
      }
      while (theoreticalTempo > 180) {
        theoreticalTempo /= 2;
      }
      theoreticalTempo = Math.round(theoreticalTempo);
      const foundTempo = tempoCounts.some((tempoCount) => {
        if (tempoCount.tempo === theoreticalTempo) {
          tempoCount.count += intervalCount.count;
          return tempoCount.count;
        }
        return false;
      });
      if (!foundTempo) {
        const tempo = {
          tempo: theoreticalTempo,
          count: intervalCount.count
        };
        tempoCounts.push(tempo);
      }
    }
    return tempoCounts;
  }

  // src/realtime-bpm-analyzer.ts
  var initialValue = {
    minValidThreshold: () => 0.3,
    timeoutStabilization: () => null,
    validPeaks: () => generateValidPeaksModel(),
    nextIndexPeaks: () => generateNextIndexPeaksModel(),
    chunkCoeff: () => 1
  };
  var RealTimeBpmAnalyzer = class {
    constructor(config = {}) {
      this.minValidThreshold = initialValue.minValidThreshold();
      this.timeoutStabilization = initialValue.timeoutStabilization();
      this.validPeaks = initialValue.validPeaks();
      this.nextIndexPeaks = initialValue.nextIndexPeaks();
      this.chunkCoeff = initialValue.chunkCoeff();
      this.options = {
        continuousAnalysis: false,
        computeBpmDelay: 1e4,
        stabilizationTime: 2e4
      };
      Object.assign(this.options, config);
    }
    setAsyncConfiguration(key, value) {
      if (typeof this.options[key] === "undefined") {
        console.log("Ke not found in options", key);
        return;
      }
      this.options[key] = value;
    }
    reset() {
      this.minValidThreshold = initialValue.minValidThreshold();
      this.timeoutStabilization = initialValue.timeoutStabilization();
      this.validPeaks = initialValue.validPeaks();
      this.nextIndexPeaks = initialValue.nextIndexPeaks();
      this.chunkCoeff = initialValue.chunkCoeff();
    }
    clearValidPeaks(minThreshold) {
      console.log(`[clearValidPeaks] function: under ${minThreshold}, this.minValidThreshold has been setted to that threshold.`);
      this.minValidThreshold = Number.parseFloat(minThreshold.toFixed(2));
      descendingOverThresholds((threshold) => {
        if (threshold < minThreshold) {
          delete this.validPeaks[threshold];
          delete this.nextIndexPeaks[threshold];
        }
      });
    }
    analyze(channelData, audioSampleRate, bufferSize, postMessage) {
      const currentMaxIndex = bufferSize * this.chunkCoeff;
      const currentMinIndex = currentMaxIndex - bufferSize;
      this.findPeaks(channelData, bufferSize, currentMinIndex, currentMaxIndex);
      this.chunkCoeff++;
      const result = computeBpm(this.validPeaks, audioSampleRate);
      const { threshold } = result;
      postMessage({ message: "BPM", result });
      if (this.minValidThreshold < threshold) {
        postMessage({ message: "BPM_STABLE", result });
        this.clearValidPeaks(threshold);
      }
      if (this.options.continuousAnalysis) {
        clearTimeout(this.timeoutStabilization);
        this.timeoutStabilization = setTimeout(() => {
          console.log("[timeoutStabilization] setTimeout: Fired !");
          this.options.computeBpmDelay = 0;
          this.reset();
        }, this.options.stabilizationTime);
      }
    }
    findPeaks(channelData, bufferSize, currentMinIndex, currentMaxIndex) {
      descendingOverThresholds(
        (threshold) => {
          if (this.nextIndexPeaks[threshold] >= currentMaxIndex) {
            return;
          }
          const offsetForNextPeak = this.nextIndexPeaks[threshold] % bufferSize;
          const { peaks, threshold: atThreshold } = findPeaksAtThreshold(channelData, threshold, offsetForNextPeak);
          if (peaks.length === 0) {
            return;
          }
          for (const relativeChunkPeak of peaks) {
            if (typeof relativeChunkPeak === "undefined") {
              continue;
            }
            this.nextIndexPeaks[atThreshold] = currentMinIndex + relativeChunkPeak + 1e4;
            this.validPeaks[atThreshold].push(currentMinIndex + relativeChunkPeak);
          }
        },
        this.minValidThreshold
      );
    }
  };

  // src/realtime-bpm-processor.ts
  var RealTimeBpmProcessor = class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.bufferSize = 4096;
      this._bytesWritten = 0;
      this._buffer = new Float32Array(this.bufferSize);
      this.realTimeBpmAnalyzer = new RealTimeBpmAnalyzer();
      this.initBuffer();
      this.port.addEventListener("message", this.onMessage.bind(this));
      this.port.start();
    }
    onMessage(event) {
      if (event.data.message === "ASYNC_CONFIGURATION") {
        for (const key of Object.keys(event.data.parameters)) {
          this.realTimeBpmAnalyzer.setAsyncConfiguration(key, event.data.parameters[key]);
        }
      }
    }
    initBuffer() {
      this._bytesWritten = 0;
    }
    isBufferEmpty() {
      return this._bytesWritten === 0;
    }
    isBufferFull() {
      return this._bytesWritten === this.bufferSize;
    }
    process(inputs, _outputs, _parameters) {
      this.append(inputs[0][0]);
      if (this.isBufferFull()) {
        this.realTimeBpmAnalyzer.analyze(this._buffer, sampleRate, this.bufferSize, (event) => {
          this.port.postMessage(event);
        });
      }
      return true;
    }
    append(channelData) {
      if (this.isBufferFull()) {
        this.flush();
      }
      if (!channelData) {
        return;
      }
      for (const data of channelData) {
        this._buffer[this._bytesWritten++] = data;
      }
    }
    flush() {
      this.initBuffer();
    }
  };
  registerProcessor(realtimeBpmProcessorName, RealTimeBpmProcessor);
})();
