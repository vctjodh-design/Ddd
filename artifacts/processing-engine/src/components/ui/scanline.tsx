import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

export const Scanline = () => {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 h-full w-full overflow-hidden opacity-10">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] [background-position:0_0,0_0]" />
      <motion.div
        className="absolute inset-0 h-[20%] w-full bg-gradient-to-b from-transparent via-primary/5 to-transparent"
        animate={{
          y: ["-100%", "500%"],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "linear",
        }}
      />
    </div>
  );
};
