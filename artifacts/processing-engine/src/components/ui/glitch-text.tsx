import React from "react";
import { motion } from "framer-motion";

export const GlitchText = ({
  text,
  className = "",
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) => {
  return (
    <div className={`relative inline-block ${className}`}>
      <motion.span
        className="absolute top-0 left-[2px] -ml-[2px] text-primary opacity-70 mix-blend-screen"
        animate={{
          x: [0, -2, 2, -1, 0],
          y: [0, 1, -1, 0, 0],
          opacity: [0.7, 0.8, 0.4, 0.9, 0.7],
        }}
        transition={{
          duration: 0.2,
          repeat: Infinity,
          repeatType: "mirror",
          delay,
        }}
      >
        {text}
      </motion.span>
      <motion.span
        className="absolute top-0 left-[-2px] -ml-[2px] text-secondary opacity-70 mix-blend-screen"
        animate={{
          x: [0, 2, -2, 1, 0],
          y: [0, -1, 1, 0, 0],
          opacity: [0.7, 0.9, 0.3, 0.8, 0.7],
        }}
        transition={{
          duration: 0.2,
          repeat: Infinity,
          repeatType: "mirror",
          delay: delay + 0.1,
        }}
      >
        {text}
      </motion.span>
      <span className="relative z-10">{text}</span>
    </div>
  );
};
