import React, { useEffect, useRef, useState } from "react";
import Human from "@vladmandic/human";
import { supabase } from "../lib/supabase";
import Spinner from "./Spinner";
import { FaEye, FaEyeSlash } from "react-icons/fa";
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
  const [passwordToggle, setPasswordToggle] = useState(false);

  const [isWebcamRunning, setWebcamRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Liveness tracking
  const prevBoxRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
    t: number;
  } | null>(null);
  const liveScoreRef = useRef<number>(0);
  // Blink/liveness using eye aspect ratio (EAR)
  const lastBlinkAtRef = useRef<number>(0);
  const wasEyeClosedRef = useRef<boolean>(false);

  // --- Auth state (email/password + session) ---
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [faceAuthLoading, setFaceAuthLoading] = useState(false);
  const [embeddingFromSupabase, setEmbeddingFromSupabase] = useState<
    number[] | null
  >(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Matching threshold (lower distance is better)
  const MATCH_DISTANCE = 0.75;
  // Slightly more lenient threshold for auth login flow
  const FACE_LOGIN_MATCH_DISTANCE = 0.95;

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

  // Eye Aspect Ratio helpers (MediaPipe indices)
  const earDistance = (a: [number, number], b: [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]);
  const computeEAR = (mesh: Array<[number, number, number]>, idx: number[]) => {
    // idx mapping expects 6 points: [p1, p2, p3, p4, p5, p6]
    const p1 = mesh[idx[0]];
    const p2 = mesh[idx[1]];
    const p3 = mesh[idx[2]];
    const p4 = mesh[idx[3]];
    const p5 = mesh[idx[4]];
    const p6 = mesh[idx[5]];
    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return null;
    const vertical1 = earDistance([p2[0], p2[1]], [p6[0], p6[1]]);
    const vertical2 = earDistance([p3[0], p3[1]], [p5[0], p5[1]]);
    const horizontal = earDistance([p1[0], p1[1]], [p4[0], p4[1]]);
    if (horizontal === 0) return null;
    return (vertical1 + vertical2) / (2.0 * horizontal);
  };

  const LEFT_EYE = [33, 160, 158, 133, 153, 144];
  const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
  const EAR_CLOSED = 0.18;
  const EAR_OPEN = 0.25;

  useEffect(() => {
    const initHuman = async () => {
      const h = new Human({
        modelBasePath: "https://vladmandic.github.io/human/models", //get all default model from library used for face recognition
        face: {
          enabled: true,
          detector: { enabled: true },
          mesh: { enabled: true },
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

  // Check auth session on mount
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session ?? null;
      setIsLoggedIn(!!session);
      setCurrentUserEmail(session?.user?.email ?? null);
      if (session?.user?.email) setAuthEmail(session.user.email);
    };
    check();
  }, []);

  // Load face embedding for the typed email from Supabase
  useEffect(() => {
    const load = async () => {
      if (!authEmail) {
        setEmbeddingFromSupabase(null);
        setProfileName(null);
        return;
      }
      const { data } = await supabase
        .from("face_profiles")
        .select("embedding,name")
        .eq("email", authEmail)
        .maybeSingle();
      if (data?.embedding) {
        setEmbeddingFromSupabase(data.embedding as number[]);
        setProfileName((data as any).name ?? authEmail);
      } else {
        setEmbeddingFromSupabase(null);
        setProfileName(null);
      }
    };
    load();
  }, [authEmail]);

  // If we have a profile embedding from Supabase, ensure it is part of knownFaces
  useEffect(() => {
    if (!embeddingFromSupabase || !authEmail) return;
    const nameToUse = profileName || authEmail;
    setKnownFaces((prev) => {
      const idx = prev.findIndex((f) => f.name === nameToUse);
      if (idx >= 0) {
        // Update existing entry's embedding
        const next = prev.slice();
        next[idx] = { name: nameToUse, embedding: embeddingFromSupabase };
        return next;
      }
      return [...prev, { name: nameToUse, embedding: embeddingFromSupabase }];
    });
  }, [embeddingFromSupabase, authEmail, profileName]);
  // Load saved known faces on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("knownFaces");
      if (saved) {
        const parsed = JSON.parse(saved) as KnownFace[];
        if (Array.isArray(parsed)) setKnownFaces(parsed);
      }
    } catch (_e) {
      console.error("Error loading known faces:", _e);
    }
  }, []);

  // Persist known faces whenever they change
  useEffect(() => {
    try {
      localStorage.setItem("knownFaces", JSON.stringify(knownFaces));
    } catch (_e) {
      console.error("Error persisting known faces:", _e);
    }
  }, [knownFaces]);

  // Email/password login
  const loginWithEmailPassword = async () => {
    try {
      setAuthLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (error) {
        alert(error.message);
        return;
      }
      setIsLoggedIn(true);
      setCurrentUserEmail(data.user?.email ?? authEmail);
      alert("Logged in successfully.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Email/password signup
  const signupWithEmailPassword = async () => {
    try {
      setAuthLoading(true);
      const { data, error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
      });
      if (error) {
        alert(error.message);
        return;
      }
      if (data?.session) {
        setCurrentUserEmail(data?.user?.email ?? null);
        alert("Signup successful.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setIsLoggedIn(false);
    setCurrentUserEmail(null);
  };

  // Face-based auth: if face profile exists for email, match and "log in";
  // otherwise, enroll a new face profile for that email.
  const loginOrEnrollWithFace = async () => {
    if (!human) {
      alert("Model not ready yet. Please wait and try again.");
      return;
    }
    if (!videoRef.current) {
      alert("Video not ready. Start the webcam first.");
      return;
    }
    try {
      setFaceAuthLoading(true);
      if (!isWebcamRunning) {
        await startWebcam();
      }

      const samples: number[][] = [];
      const boxCenters: Array<{ cx: number; cy: number; area: number }> = [];
      let blinked = false;
      const maxSamples = 7;
      const maxTries = 40;
      let tries = 0;
      while (samples.length < maxSamples && tries < maxTries) {
        const result = await human.detect(videoRef.current);
        if (result.face.length && result.face[0].embedding) {
          samples.push(l2Normalize(result.face[0].embedding));
          const [x, y, w, h] = result.face[0].box;
          boxCenters.push({ cx: x + w / 2, cy: y + h / 2, area: w * h });
          const mesh = (result.face[0] as any).mesh as
            | Array<[number, number, number]>
            | undefined;
          if (mesh && Array.isArray(mesh)) {
            const left = computeEAR(mesh, LEFT_EYE);
            const right = computeEAR(mesh, RIGHT_EYE);
            if (left !== null && right !== null) {
              const ear = (left + right) / 2;
              if (!wasEyeClosedRef.current && ear < EAR_CLOSED) {
                wasEyeClosedRef.current = true;
              }
              if (wasEyeClosedRef.current && ear > EAR_OPEN) {
                wasEyeClosedRef.current = false;
                blinked = true;
              }
            }
          }
        }
        await new Promise((r) => setTimeout(r, 120));
        tries++;
      }
      if (!samples.length) {
        alert("Face not detected. Try again with better lighting.");
        return;
      }
      // Liveness metrics across samples
      let maxDist = 0;
      let maxAreaChange = 0;
      for (let i = 1; i < boxCenters.length; i++) {
        const a = boxCenters[i - 1];
        const b = boxCenters[i];
        const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
        const areaChange = Math.abs(b.area - a.area) / Math.max(a.area, 1);
        if (dist > maxDist) maxDist = dist;
        if (areaChange > maxAreaChange) maxAreaChange = areaChange;
      }
      const durationMs =
        boxCenters.length >= 2 ? (boxCenters.length - 1) * 120 : 0;
      const movedLoose = maxDist > 3 || maxAreaChange > 0.02;
      const movedStrict =
        (maxDist > 4 || maxAreaChange > 0.03) && durationMs >= 600;
      const length = samples[0].length;
      const mean = new Array(length).fill(0);
      for (const s of samples) {
        for (let i = 0; i < length; i++) mean[i] += s[i];
      }
      for (let i = 0; i < length; i++) mean[i] /= samples.length;
      const liveEmbedding = l2Normalize(mean);

      if (embeddingFromSupabase) {
        // Loose liveness gate for login
        if (!movedLoose && !blinked) {
          alert(
            "Liveness check failed. Please move your head slightly and try again."
          );
          return;
        }
        if (embeddingFromSupabase.length !== liveEmbedding.length) {
          alert(
            "Your saved profile is from a different model version. Updating your face profile now."
          );
          const { data: userData } = await supabase.auth.getUser();
          const user_id = userData?.user?.id ?? null;
          await supabase.from("face_profiles").upsert(
            {
              user_id,
              email: authEmail,
              name: profileName || authEmail,
              embedding: liveEmbedding,
            },
            { onConflict: "email" }
          );
          setEmbeddingFromSupabase(liveEmbedding);
          alert("Face profile updated. Please try face login again.");
          return;
        }

        const distance = euclideanDistance(
          liveEmbedding,
          l2Normalize(embeddingFromSupabase)
        );
        if (distance <= FACE_LOGIN_MATCH_DISTANCE) {
          alert("Face matched — logging you in!");
          window.location.href = "/welcome";
          await supabase.auth.signInWithPassword({
            email: authEmail,
            password: authPassword || "anything",
          });
          const { data } = await supabase.auth.getSession();
          setIsLoggedIn(!!data.session);
          setCurrentUserEmail(authEmail);
          return;
        } else {
          alert(
            `Face does not match the saved profile (distance ${distance.toFixed(
              3
            )}). Try better lighting/angle or update your profile.`
          );
          return;
        }
      } else {
        // Strict liveness gate for enrollment: require blink AND movement
        if (!(blinked && movedStrict)) {
          alert(
            "Liveness check failed for enrollment. Please blink AND move your head slightly, then try again."
          );
          return;
        }
        if (!authEmail) {
          alert("Enter your email before enrolling your face.");
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        const user_id = userData?.user?.id ?? null;
        const file = fileInputRef.current?.files?.[0];
        if (!file) return;
        const imagePath = await uploadToFacesBucket(file, authEmail);
        if (!imagePath) return;
        await supabase.from("face_profiles").upsert(
          {
            user_id,
            email: authEmail,
            name: authEmail,
            embedding: liveEmbedding,
            image_path: imagePath,
          },
          { onConflict: "email" }
        );
        setEmbeddingFromSupabase(liveEmbedding);
        alert("Face enrolled successfully for this email.");
      }
    } finally {
      setFaceAuthLoading(false);
    }
  };

  // Explicitly update/overwrite the face profile for current email
  const updateFaceProfile = async () => {
    if (!human) {
      alert("Model not ready yet. Please wait and try again.");
      return;
    }
    if (!videoRef.current) {
      alert("Video not ready. Start the webcam first.");
      return;
    }
    if (!authEmail) {
      alert("Enter your email before updating your face profile.");
      return;
    }
    try {
      if (!isWebcamRunning) {
        await startWebcam();
      }
      const samples: number[][] = [];
      const boxCenters: Array<{ cx: number; cy: number; area: number }> = [];
      let blinked = false;
      const maxSamples = 7;
      const maxTries = 40;
      let tries = 0;
      while (samples.length < maxSamples && tries < maxTries) {
        const result = await human.detect(videoRef.current);
        if (result.face.length && result.face[0].embedding) {
          samples.push(l2Normalize(result.face[0].embedding));
          const [x, y, w, h] = result.face[0].box;
          boxCenters.push({ cx: x + w / 2, cy: y + h / 2, area: w * h });
          const mesh = (result.face[0] as any).mesh as
            | Array<[number, number, number]>
            | undefined;
          if (mesh && Array.isArray(mesh)) {
            const left = computeEAR(mesh, LEFT_EYE);
            const right = computeEAR(mesh, RIGHT_EYE);
            if (left !== null && right !== null) {
              const ear = (left + right) / 2;
              if (!wasEyeClosedRef.current && ear < EAR_CLOSED) {
                wasEyeClosedRef.current = true;
              }
              if (wasEyeClosedRef.current && ear > EAR_OPEN) {
                wasEyeClosedRef.current = false;
                blinked = true;
              }
            }
          }
        }
        await new Promise((r) => setTimeout(r, 120));
        tries++;
      }
      if (!samples.length) {
        alert("Face not detected. Try again with better lighting.");
        return;
      }
      // Strict liveness gate for profile update
      let maxDist = 0;
      let maxAreaChange = 0;
      for (let i = 1; i < boxCenters.length; i++) {
        const a = boxCenters[i - 1];
        const b = boxCenters[i];
        const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
        const areaChange = Math.abs(b.area - a.area) / Math.max(a.area, 1);
        if (dist > maxDist) maxDist = dist;
        if (areaChange > maxAreaChange) maxAreaChange = areaChange;
      }
      const durationMs =
        boxCenters.length >= 2 ? (boxCenters.length - 1) * 120 : 0;
      const movedStrict =
        (maxDist > 4 || maxAreaChange > 0.03) && durationMs >= 600;
      // Strict liveness for update: require blink AND movement
      if (!(blinked && movedStrict)) {
        alert(
          "Liveness check failed for update. Please blink AND move your head slightly, then try again."
        );
        return;
      }
      const length = samples[0].length;
      const mean = new Array(length).fill(0);
      for (const s of samples) {
        for (let i = 0; i < length; i++) mean[i] += s[i];
      }
      for (let i = 0; i < length; i++) mean[i] /= samples.length;
      const liveEmbedding = l2Normalize(mean);

      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData?.user?.id ?? null;
      await supabase.from("face_profiles").upsert(
        {
          user_id,
          email: authEmail,
          name: profileName || authEmail,
          embedding: liveEmbedding,
        },
        { onConflict: "email" }
      );
      setEmbeddingFromSupabase(liveEmbedding);
      alert("Face profile updated successfully.");
    } catch (_e) {
      alert("Failed to update face profile. Please try again.");
    }
  };

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
  };

  const stopWebcam = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    videoRef.current!.srcObject = null;
    setWebcamRunning(false);
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
          // Basic liveness estimation using box motion/scale change over frames
          const [x, y, w, h] = face.box;
          const cx = x + w / 2;
          const cy = y + h / 2;
          const area = w * h;
          // Blink detection using eye aspect ratio if mesh present
          if ((face as any).mesh && Array.isArray((face as any).mesh)) {
            const mesh = (face as any).mesh as Array<[number, number, number]>;
            const left = computeEAR(mesh, LEFT_EYE);
            const right = computeEAR(mesh, RIGHT_EYE);
            if (left !== null && right !== null) {
              const ear = (left + right) / 2;
              if (!wasEyeClosedRef.current && ear < EAR_CLOSED) {
                wasEyeClosedRef.current = true;
              }
              if (wasEyeClosedRef.current && ear > EAR_OPEN) {
                wasEyeClosedRef.current = false;
                lastBlinkAtRef.current = performance.now();
              }
            }
          }
          if (prevBoxRef.current) {
            const pcx = prevBoxRef.current.x + prevBoxRef.current.w / 2;
            const pcy = prevBoxRef.current.y + prevBoxRef.current.h / 2;
            const parea = prevBoxRef.current.w * prevBoxRef.current.h;
            const dist = Math.hypot(cx - pcx, cy - pcy);
            const areaChange = Math.abs(area - parea) / Math.max(parea, 1);
            let inc = 0;
            if (dist > 3) inc += 1; // minimal head movement
            if (areaChange > 0.02) inc += 1; // >2% scale change
            liveScoreRef.current = Math.max(
              0,
              Math.min(5, liveScoreRef.current * 0.9 + inc)
            );
          }
          prevBoxRef.current = { x, y, w, h, t: performance.now() };
          const isLive = liveScoreRef.current >= 1.5;
          const blinkRecent =
            performance.now() - (lastBlinkAtRef.current || 0) < 4000;

          if (!isLive || !blinkRecent) {
            // Skip labeling/static image detections
            return;
          }

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

  //upload to face bucket
  const uploadToFacesBucket = async (
    file: Blob,
    email: string
  ): Promise<string | null> => {
    try {
      const safeDir = (email || "anonymous").replace(/[^a-zA-Z0-9@._-]/g, "_");
      const filePath = `${safeDir}/${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("faces")
        .upload(filePath, file, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (error) {
        console.error("Storage upload error:", error);
        alert(`Storage upload failed: ${error.message}`);
        return null;
      }
      return filePath;
    } catch (e) {
      console.error("uploadToFacesBucket failed:", e);
      return null;
    }
  };

  //upload test
  const handleTestUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!human) {
        alert("Model not ready yet. Please wait and try again.");
        return;
      }
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await new Promise((res, rej) => {
        img.onload = () => res(null);
        img.onerror = () => rej(new Error("Failed to load image"));
      });
      const result = await human.detect(img as HTMLImageElement);
      if (!result.face.length || !result.face[0].embedding) {
        alert("No face detected in the uploaded image.");
        return;
      }
      const embedding = l2Normalize(result.face[0].embedding);

      if (embeddingFromSupabase) {
        const distance = euclideanDistance(
          embedding,
          l2Normalize(embeddingFromSupabase)
        );
        alert(
          distance <= FACE_LOGIN_MATCH_DISTANCE
            ? `Match (distance ${distance.toFixed(3)})`
            : `Not a match (distance ${distance.toFixed(3)})`
        );
        return;
      }

      if (!isLoggedIn || !authEmail) {
        alert("Please login first, then upload an image to enroll.");
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData?.user?.id ?? null;
      // Upload original file to Storage to get required image_path
      const imagePath = await uploadToFacesBucket(file, authEmail);
      if (!imagePath) return;
      const { error: upErr } = await supabase.from("face_profiles").upsert(
        {
          user_id,
          email: authEmail,
          name: profileName || authEmail,
          embedding,
          image_path: imagePath,
        },
        { onConflict: "email" }
      );
      if (upErr) {
        alert(`Failed to enroll face profile: ${upErr.message}`);
        return;
      }
      setEmbeddingFromSupabase(embedding);
      alert("Face enrolled successfully from uploaded image.");
      setUploading(false);
    } catch (_e) {
      alert("Failed to process uploaded image.");
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 py-6 ">
      {/* Auth controls (email/password + face) */}
      <div className="mb-6 border rounded-md p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold">Authentication</h3>
            <p className="text-sm text-gray-600">
              {isLoggedIn ? (
                <>
                  Logged in as{" "}
                  <span className="font-medium">{currentUserEmail}</span>
                </>
              ) : (
                "Not authenticated"
              )}
            </p>
            {isLoggedIn && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleTestUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300 transition-colors disabled:opacity-60"
                  disabled={uploading}
                >
                  {uploading ? (
                    <Spinner size={16} className=" animate-spin text-red-600" />
                  ) : (
                    "Upload face image (test)"
                  )}
                </button>
                <span className="text-xs text-gray-500">
                  Enrolls if no profile; otherwise tries to match.
                </span>
              </div>
            )}
          </div>
          {isLoggedIn ? (
            <button
              onClick={logout}
              className="bg-gray-200 hover:bg-gray-300 transition-colors px-3 py-2 rounded-md text-sm"
            >
              Logout
            </button>
          ) : null}
        </div>

        {!isLoggedIn && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-0"
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
            />
            <div className="rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-0 flex justify-between items-center">
              <input
                type={passwordToggle ? "text" : "password"}
                className="w-full focus:outline-none focus:ring-0"
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
              <button
                onClick={() => setPasswordToggle(!passwordToggle)}
                className="text-gray-500 hover:text-gray-700 cursor-pointer justify-end "
              >
                {!passwordToggle ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={loginWithEmailPassword}
                disabled={authLoading}
                className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {authLoading ? "..." : "Login"}
              </button>
              <button
                onClick={signupWithEmailPassword}
                disabled={authLoading}
                className="flex-1 rounded-md bg-green-600 px-3 py-2 text-white hover:bg-green-700 transition-colors disabled:opacity-60"
              >
                {authLoading ? "..." : "Signup"}
              </button>
            </div>
            <div className="md:col-span-3">
              <button
                onClick={loginOrEnrollWithFace}
                disabled={faceAuthLoading}
                className="w-full rounded-md bg-gray-800 px-3 py-2 text-white hover:bg-gray-900 transition-colors disabled:opacity-60"
              >
                {faceAuthLoading
                  ? "Scanning face..."
                  : "Login with Face (or Enroll if new)"}
              </button>
              <p className="text-xs text-gray-500 mt-1">
                Ensure the webcam is started for face login. If no profile
                exists for the entered email, your face will be enrolled.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={updateFaceProfile}
                  className="rounded-md bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300 transition-colors"
                >
                  Update Face Profile for this email
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {!isLoggedIn && (
        <>
          <div className="mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-blue-600">
              Live Face Recognition
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Status:{" "}
              <span
                className={isWebcamRunning ? "text-green-600" : "text-red-600"}
              >
                {isWebcamRunning
                  ? "Webcam is running"
                  : "Webcam is not running"}
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
        </>
      )}
    </div>
  );
};

export default FaceRecognition;
