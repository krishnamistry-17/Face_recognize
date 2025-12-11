import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";
import FaceRecognition from "./components/FaceRecognition";

test("renders learn react link", () => {
  render(<App />);
  const linkElement = screen.getByText(/learn react/i);
  expect(linkElement).toBeInTheDocument();
});

test("render face recognization component", () => {
  render(<FaceRecognition />);
  const faceElemet = screen.getByText(/Face Recognition/i);
  expect(faceElemet).toBeInTheDocument();
});
