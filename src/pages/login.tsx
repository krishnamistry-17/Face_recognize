import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import Human from "@vladmandic/human";
import { useNavigate } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const [faceMode, setFaceMode] = useState(false);
  const [human, setHuman] = useState<Human | null>(null);
  const [loading, setLoading] = useState(false);

  const [embeddingFromSupabase, setEmbeddingFromSupabase] = useState<
    number[] | null
  >(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const navigate = useNavigate();

  const MATCH_DISTANCE = 0.75;

  // -------------------------------------
  // Utility
  // -------------------------------------
  const l2Normalize = (v: number[]) => {
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / n);
  };
  const euclidean = (a: number[], b: number[]) => {
    if (!a || !b || a.length !== b.length) return Infinity;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s);
  };

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) navigate("/");
    };
    check();
  }, []);

  useEffect(() => {
    if (!faceMode) return;

    const loadModel = async () => {
      const h = new Human({
        modelBasePath: "https://vladmandic.github.io/human/models",
        face: {
          enabled: true,
          detector: { enabled: true },
          description: { enabled: true },
        },
      });

      await h.init();
      await h.load();
      await h.warmup();
      setHuman(h);
    };

    loadModel();
  }, [faceMode]);

  useEffect(() => {
    if (!email) return;

    const loadEmbedding = async () => {
      const { data, error } = await supabase
        .from("face_profiles")
        .select("embedding")
        .eq("email", email)
        .maybeSingle();

      if (data?.embedding) {
        setEmbeddingFromSupabase(data.embedding);
      } else {
        setEmbeddingFromSupabase(null);
      }
    };

    loadEmbedding();
  }, [email]);

  const startCamera = async () => {
    if (!videoRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });

    videoRef.current.srcObject = stream;
    videoRef.current.muted = true;
    (videoRef.current as any).playsInline = true;

    await videoRef.current.play();

    videoRef.current.onloadedmetadata = () => {
      if (canvasRef.current) {
        canvasRef.current.width = videoRef.current!.videoWidth;
        canvasRef.current.height = videoRef.current!.videoHeight;
      }
    };
  };

  useEffect(() => {
    if (!human || !faceMode) return;

    let active = true;

    const loop = async () => {
      if (!active) return;

      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d")!;

        const result = await human.detect(video);

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        for (const face of result.face) {
          if (!face.embedding) continue;

          const live = l2Normalize(face.embedding);

          const [x, y, w, h] = face.box;

          // Draw box
          ctx.strokeStyle = "green";
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, w, h);

          ctx.fillStyle = "green";
          ctx.font = "18px Arial";
          ctx.fillText("Scanning...", x, y - 10);

          if (embeddingFromSupabase) {
            const dist = euclidean(live, l2Normalize(embeddingFromSupabase));

            if (dist <= MATCH_DISTANCE) {
              active = false;
              await loginWithFace();
              return;
            }
          }

          if (!embeddingFromSupabase) {
            active = false;
            await enrollFace(live);
            return;
          }
        }
      }

      requestAnimationFrame(loop);
    };

    loop();
    return () => {
      active = false;
    };
  }, [human, faceMode, embeddingFromSupabase]);

  const loginWithFace = async () => {
    alert("Face matched — logging you in!");
    navigate("/");

    // passwordless face login
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: "anything", // not used (user already authenticated by face)
    });

    navigate("/");
  };

  const enrollFace = async (embedding: number[]) => {
    alert("New face detected — enrolling profile...");

    const normalized = l2Normalize(embedding);

    // Get supabase user
    const { data: userData } = await supabase.auth.getUser();
    const user_id = userData?.user?.id ?? null;

    await supabase.from("face_profiles").upsert(
      {
        user_id,
        email,
        name: email,
        embedding: normalized,
      },
      { onConflict: "email" }
    );

    setEmbeddingFromSupabase(normalized);

    alert("Face enrolled successfully!");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return alert(error.message);

    navigate("/");
  };

  const openFaceMode = async () => {
    setFaceMode(true);
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setFaceMode(false);
  };

  // Start camera when popup opens
  useEffect(() => {
    if (faceMode) startCamera();
  }, [faceMode]);

  return (
    <div className="flex flex-col mx-auto max-w-lg p-4">
      <h1 className="text-2xl font-bold mb-4">Login</h1>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <input
          className="border p-2 rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
        />

        <div className="border p-2 rounded flex items-center">
          <input
            className="flex-1"
            type={isPasswordVisible ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {isPasswordVisible ? (
            <FaEyeSlash onClick={() => setIsPasswordVisible(false)} />
          ) : (
            <FaEye onClick={() => setIsPasswordVisible(true)} />
          )}
        </div>

        <button className="bg-blue-600 text-white p-2 rounded">Login</button>
      </form>

      <button
        onClick={openFaceMode}
        className="bg-gray-600 text-white p-2 rounded mt-4"
      >
        Login With Face
      </button>

      {/* FACE LOGIN POPUP */}
      {faceMode && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            playsInline
          />

          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none"
          />

          <button
            onClick={stopCamera}
            className="absolute top-5 right-5 bg-red-600 px-4 py-2 text-white rounded"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

export default Login;
