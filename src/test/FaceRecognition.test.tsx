import { fireEvent, render, screen } from "@testing-library/react";
import FaceRecognition from "../components/FaceRecognition";

test("renders Authentication header", async () => {
  render(<FaceRecognition />);
  expect(await screen.findByText(/Authentication/i)).toBeInTheDocument();
});

test("shows live face recognition section", async () => {
  render(<FaceRecognition />);
  expect(await screen.findByText(/Live Face Recognition/i)).toBeInTheDocument();
});

test("webcame section working with start and stream properly", async () => {
  render(<FaceRecognition />);
  const startWebcam = screen.getByText("Start Webcam");
  fireEvent.click(startWebcam);
  expect(await screen.findByText(/webcame  is running/i)).toBeInTheDocument();
});

test("face detection embedding properly", async () => {
  render(<FaceRecognition />);
  const faceDetection = screen.getByText("Face Detection");
  fireEvent.click(faceDetection);
});

test("face detection liveness properly", async () => {
  render(<FaceRecognition />);
  const faceDetection = screen.getByText("Face Detection");
  fireEvent.click(faceDetection);
  expect(
    await screen.findByText(/face detection is working/i)
  ).toBeInTheDocument();
});

test("face detection blink properly", async () => {
  render(<FaceRecognition />);
  const faceDetection = screen.getByText("Face Detection");
  fireEvent.click(faceDetection);
  expect(
    await screen.findByText(/face detection is working/i)
  ).toBeInTheDocument();
});

test("uploaded image detect and match properly", async () => {
  render(<FaceRecognition />);
  const uploadedImage = screen.getByText("Upload Image");
  fireEvent.click(uploadedImage);
  expect(
    await screen.findByText(/uploaded image is detected/i)
  ).toBeInTheDocument();
  const matchImage = screen.getByText("Match Image");
  fireEvent.click(matchImage);
  expect(await screen.findByText(/image is matched/i)).toBeInTheDocument();
});
