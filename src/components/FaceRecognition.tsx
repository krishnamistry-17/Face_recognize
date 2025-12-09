import React, { useEffect, useRef, useState } from "react";
import Human from "@vladmandic/human";

interface KnownFace {
  name: string;
  embedding: number[];
}

const FaceRecognition: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [human, setHuman] = useState<Human | null>(null);
  const [knownFaces, setKnownFaces] = useState<KnownFace[]>([]);
  const [newFaceName, setNewFaceName] = useState("");
  const [useBackCamera, setUseBackCamera] = useState(false);

  const [isWebcamRunning, setWebcamRunning] = useState(false);

  // Matching threshold (lower distance is better)
  const MATCH_DISTANCE = 0.75;

  // Euclidean Distance
  const euclideanDistance = (a: number[], b: number[]) => {
    if (!a || !b || a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
  };

  //L2 Normalize- Normalize the embedding to a unit vector
  const l2Normalize = (v: number[]) => {
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  };

  //find the nearest new faces
  const nearest = (embedding: number[], descriptors: number[][]) => {
    const normEmb = l2Normalize(embedding);
    const distances = descriptors.map((d) =>
      euclideanDistance(normEmb, l2Normalize(d))
    );
    const minIndex = distances.indexOf(Math.min(...distances));
    return { index: minIndex, distance: distances[minIndex] };
  };

  useEffect(() => {
    const initHuman = async () => {
      const h = new Human({
        modelBasePath: "https://vladmandic.github.io/human/models", //get all default model from library used for face recognition
        face: {
          enabled: true,
          detector: { enabled: true },
          mesh: { enabled: false },
          description: { enabled: true }, //add description to the face and it find face in the image
        },
      });

      await h.init();
      await h.load();
      await h.warmup();
      setHuman(h);
    };

    initHuman();
  }, []);

  // Load saved known faces on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("knownFaces");
      if (saved) {
        const parsed = JSON.parse(saved) as KnownFace[];
        if (Array.isArray(parsed)) setKnownFaces(parsed);
      }
      console.log("knownFaces", knownFaces);
      console.log("saved", saved);
    } catch (_e) {}
  }, []);

  // Persist known faces whenever they change
  useEffect(() => {
    try {
      localStorage.setItem("knownFaces", JSON.stringify(knownFaces));
    } catch (_e) {}
  }, [knownFaces]);

  const startWebcam = async () => {
    try {
      if (!videoRef.current) return;
      if (
        !("mediaDevices" in navigator) ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        alert("getUserMedia is not supported in this browser or context.");
        return;
      }

      // Stop existing stream if present
      const existing = videoRef.current.srcObject as MediaStream | null;
      if (existing) {
        existing.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 640,
          height: 480,
          facingMode: useBackCamera ? "environment" : "user",
        },
        audio: false,
      });

      videoRef.current.srcObject = stream;
      // ensure autoplay works on mobile
      videoRef.current.muted = true;
      (videoRef.current as any).playsInline = true;
      try {
        await videoRef.current.play();
      } catch (_e) {}
      setWebcamRunning(true);

      videoRef.current.onloadedmetadata = () => {
        if (canvasRef.current && videoRef.current) {
          canvasRef.current.width = videoRef.current.videoWidth || 640;
          canvasRef.current.height = videoRef.current.videoHeight || 480;
        }
      };
    } catch (err) {
      console.error("startWebcam error:", err);
      alert(
        "Unable to access camera. Check permissions and that no other app is using it."
      );
    }
  };

  const pauseWebcam = () => {
    videoRef.current?.pause();
    setWebcamRunning(false);
    console.log("Webcam paused");
  };

  const stopWebcam = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    videoRef.current!.srcObject = null;
    setWebcamRunning(false);
    console.log("Webcam stopped");
  };

  useEffect(() => {
    if (!human) return;

    let isActive = true;

    const detectLoop = async () => {
      if (!isActive) return;

      if (videoRef.current && canvasRef.current && isWebcamRunning) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        //draw canvas
        const draw = canvas.getContext("2d")!;

        // Run Human.js detection
        const result = await human.detect(video);

        // Draw video frame
        draw.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Draw faces
        result.face.forEach((face) => {
          if (!face.embedding) return;
          let name = "Unknown";
          const entries = knownFaces.filter(
            (k) => k.embedding && k.embedding.length === face.embedding!.length
          );
          if (entries.length) {
            const descriptors = entries.map((e) => e.embedding);
            const { index, distance } = nearest(face.embedding!, descriptors);
            if (index >= 0 && distance <= MATCH_DISTANCE) {
              name = entries[index].name;
            }
          }

          const [x, y, w, h] = face.box;
          // Box
          draw.strokeStyle = "lime";
          draw.lineWidth = 2;
          draw.strokeRect(x, y, w, h);
          // Label background
          draw.fillStyle = "rgba(0,0,0,0.5)";
          draw.fillRect(x, y - 20, draw.measureText(name).width + 10, 20);
          // Label text
          draw.fillStyle = "lime";
          draw.font = "16px sans-serif";
          draw.fillText(name, x + 5, y - 5);
        });
      }

      requestAnimationFrame(detectLoop);
    };

    detectLoop();

    return () => {
      isActive = false;
    };
  }, [human, knownFaces, isWebcamRunning]);

  const addFace = async () => {
    if (!human || !videoRef.current || !newFaceName)
      return alert("Please enter a name and try again.");
    const samples: number[][] = [];
    const maxSamples = 5;
    const maxTries = 20;
    let tries = 0;
    while (samples.length < maxSamples && tries < maxTries) {
      const result = await human.detect(videoRef.current);
      if (result.face.length && result.face[0].embedding) {
        samples.push(l2Normalize(result.face[0].embedding));
      }
      await new Promise((r) => setTimeout(r, 100));
      tries++;
    }
    if (!samples.length)
      return alert("Face not detected. Try again with better lighting.");
    // average embeddings
    const length = samples[0].length;
    const mean = new Array(length).fill(0);
    for (const s of samples) {
      for (let i = 0; i < length; i++) mean[i] += s[i];
    }
    for (let i = 0; i < length; i++) mean[i] /= samples.length;
    const embedding = l2Normalize(mean);
    setKnownFaces((prev) => [...prev, { name: newFaceName, embedding }]);
    alert(`Face "${newFaceName}" added!`);
    setNewFaceName("");
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-6 ">
      <div className="mb-6">
        <h2 className="text-2xl sm:text-3xl font-bold text-blue-600">
          Live Face Recognition
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Status:{" "}
          <span className={isWebcamRunning ? "text-green-600" : "text-red-600"}>
            {isWebcamRunning ? "Webcam is running" : "Webcam is not running"}
          </span>
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button
          className={`px-4 py-2 rounded-md text-white transition-colors ${
            isWebcamRunning
              ? "bg-green-600 hover:bg-green-700"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
          onClick={startWebcam}
        >
          Start Webcam
        </button>

        <button
          className="bg-yellow-500 text-white px-4 py-2 rounded-md hover:bg-yellow-600 transition-colors"
          onClick={pauseWebcam}
        >
          Pause Webcam
        </button>
        <button
          className="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 transition-colors"
          onClick={stopWebcam}
        >
          Stop Webcam
        </button>

        <label className=" gap-2 ml-auto inline-flex items-center">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={useBackCamera}
            onChange={(e) => setUseBackCamera(e.target.checked)}
          />
          Use back camera
        </label>
      </div>

      {/* Video + Canvas */}
      <div className="relative border-2 border-gray-600 rounded mb-6">
        <video
          ref={videoRef}
          width={640}
          height={480}
          className="rounded"
          autoPlay
          muted
          playsInline
        />
        <canvas ref={canvasRef} className="absolute top-0 left-0" />
      </div>

      {/* Add Face */}
      <div className="mt-4 flex gap-2 mb-6 flex-col sm:flex-row items-stretch sm:items-center">
        <input
          className="w-full sm:w-auto flex-1 rounded-md border border-gray-300
           px-3 py-2 shadow-sm  focus:outline-none focus:ring-0"
          type="text"
          placeholder="Enter name"
          value={newFaceName}
          onChange={(e) => setNewFaceName(e.target.value)}
        />
        <button
          className="w-full sm:w-auto rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 transition-colors"
          onClick={addFace}
        >
          Add Face
        </button>
      </div>

      {/* Known Faces */}
      <div>
        <h3 className="mb-3 text-lg font-semibold">Known Faces</h3>
        {knownFaces.length === 0 ? (
          <p className="text-sm text-gray-500">No faces saved yet.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {knownFaces.map((f) => (
              <li
                key={f.name}
                className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-800"
              >
                {f.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default FaceRecognition;
