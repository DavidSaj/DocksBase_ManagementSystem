import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const NAVY  = '#0c1f3d';
const GOLD  = '#c9a84c';
const CREAM = '#faf8f5';

export default function WelcomeScreen({ name, onDone }) {
  // Auto-dismiss after 2.8s
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
      onClick={onDone}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: NAVY,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {/* Anchor ring */}
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 0.12, scale: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        style={{
          position: 'absolute',
          width: 420, height: 420, borderRadius: '50%',
          border: `1px solid ${CREAM}`,
        }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 0.06, scale: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut', delay: 0.1 }}
        style={{
          position: 'absolute',
          width: 620, height: 620, borderRadius: '50%',
          border: `1px solid ${CREAM}`,
        }}
      />

      {/* Gold rule */}
      <motion.div
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.4, 0, 0.2, 1] }}
        style={{
          width: 40, height: 2, background: GOLD,
          borderRadius: 2, marginBottom: 28,
          transformOrigin: 'center',
        }}
      />

      {/* Brand name */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.3, ease: [0.4, 0, 0.2, 1] }}
        style={{
          fontFamily: 'Georgia, serif',
          fontSize: 42, fontWeight: 700,
          color: CREAM, letterSpacing: '-1px',
          marginBottom: 14,
        }}
      >
        DocksBase
      </motion.div>

      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.55, ease: [0.4, 0, 0.2, 1] }}
        style={{
          fontSize: 16, color: 'rgba(250,248,245,0.55)',
          letterSpacing: '0.3px',
        }}
      >
        {name ? `Welcome back, ${name}.` : 'Welcome aboard.'}
      </motion.div>

      {/* Skip hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.3 }}
        transition={{ delay: 1.4, duration: 0.4 }}
        style={{ position: 'absolute', bottom: 36, fontSize: 11, color: CREAM, letterSpacing: '1px', textTransform: 'uppercase' }}
      >
        Click anywhere to continue
      </motion.div>
    </motion.div>
  );
}
