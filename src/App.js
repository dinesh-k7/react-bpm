import "./App.css";
import soundfile from "./assets/audio/sample.mp3";

import { createRealTimeBpmProcessor } from "realtime-bpm-analyzer";
import { useState } from "react";

function App() {
  const [bpmAnalyzer, setBPM] = useState({});
  const [isPlayClick, setPlayClick] = useState(false);

  const handleClick = async () => {
    setPlayClick(!isPlayClick);
    const audioContext = new AudioContext();
    const realtimeAnalyzerNode = await createRealTimeBpmProcessor(audioContext);
    const track = document.getElementById("track");
    if (
      realtimeAnalyzerNode &&
      realtimeAnalyzerNode.context &&
      realtimeAnalyzerNode.context.state &&
      realtimeAnalyzerNode.context.state === "running"
    ) {
      // Set the source with the HTML Audio Node
      const source = audioContext.createMediaElementSource(track); // Lowpass filter
      const filter = audioContext.createBiquadFilter();
      filter.type = "lowpass"; // Connect stuff together
      source.connect(filter).connect(realtimeAnalyzerNode);
      source.connect(audioContext.destination);
    }
    realtimeAnalyzerNode.port.onmessage = (event) => {
      if (event.data.message === "BPM") {
        // console.log('BPM', event.data.result);
      }
      if (event.data.message === "BPM_STABLE") {
        console.log("data.result", event.data.result);
        setBPM((previousState) => ({
          ...previousState,
          ...event.data.result,
        }));
      }
    };
  };

  return (
    <div className="app">
      <h2>RealTime Beats Per Minute Analyzer</h2>
      <p> Click on the play button to calculate the BTM </p>

      <audio
        controls="controls"
        autoPlay
        onPlay={handleClick}
        src={soundfile}
        id="track"
      ></audio>

      {bpmAnalyzer && bpmAnalyzer.threshold ? (
        <div>
          <h2>BPM details:</h2>
          <p>Threshold: {bpmAnalyzer && bpmAnalyzer.threshold} </p>

          <ul>
            {bpmAnalyzer &&
              bpmAnalyzer.bpm &&
              bpmAnalyzer.bpm.map((bp, index) => (
                <li key={index}>
                  {" "}
                  Tempo: {bp.tempo} &nbsp; Count {bp.count}{" "}
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <div>{isPlayClick && <h3>Loading...</h3>}</div>
      )}
    </div>
  );
}

export default App;
