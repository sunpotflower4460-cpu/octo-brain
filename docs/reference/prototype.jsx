import React, { useState, useEffect, useRef, memo } from 'react';
import { Send, Bot, User, Cpu, Sparkles, BrainCircuit } from 'lucide-react';

// --- 立体的なサイバーオクトパスアニメーション (独立・無停止・変更なし) ---
const OctopusCanvas = memo(({ appState }) => {
  const canvasRef = useRef(null);
  const appStateRef = useRef(appState);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const draw = () => {
      const state = appStateRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const time = Date.now() / 1000;

      ctx.fillStyle = 'rgba(2, 6, 23, 0.4)';
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height * 0.35;

      const renderQueue = [];
      const numTentacles = 8;

      for (let i = 0; i < numTentacles; i++) {
        const baseAngle = (i / numTentacles) * Math.PI * 2 + Math.sin(time * 0.1) * 0.5;
        const depth = Math.sin(baseAngle) * 350;
        renderQueue.push({ type: 'tentacle', id: i, baseAngle, depth });
      }

      renderQueue.push({ type: 'head', depth: 0 });
      renderQueue.sort((a, b) => b.depth - a.depth);

      const drawHead = () => {
        const hY = cy + Math.sin(time) * 15;
        
        ctx.beginPath();
        ctx.ellipse(cx, hY, 70, 95, 0, 0, Math.PI * 2);

        const grad = ctx.createRadialGradient(cx, hY - 30, 10, cx, hY, 100);
        if (state === 'processing_main') {
          grad.addColorStop(0, '#d8b4fe');
          grad.addColorStop(0.4, '#9333ea');
          grad.addColorStop(1, '#3b0764');
          ctx.shadowBlur = 60;
          ctx.shadowColor = '#b026ff';
        } else {
          grad.addColorStop(0, '#38bdf8');
          grad.addColorStop(0.4, '#0ea5e9');
          grad.addColorStop(1, '#082f49');
          ctx.shadowBlur = 20;
          ctx.shadowColor = '#0284c7';
        }
        
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = state === 'processing_main' ? '#e9d5ff' : '#bae6fd';
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      const drawTentacle = (tData) => {
        const segments = 45;
        const maxLength = 350;
        const fov = 500;
        const zOffset = 300;

        const points = [];
        
        for (let i = 0; i <= segments; i++) {
          const progress = i / segments;
          const r = progress * maxLength;
          
          const waveX = Math.cos(time * 2.0 + progress * 6 + tData.id) * 40 * progress;
          const waveZ = Math.sin(time * 1.5 + progress * 8 + tData.id) * 60 * progress;
          
          const x3d = Math.cos(tData.baseAngle) * r + Math.cos(tData.baseAngle + Math.PI / 2) * waveX;
          const y3d = Math.sin(tData.baseAngle) * r + Math.sin(tData.baseAngle + Math.PI / 2) * waveX;
          const z3d = waveZ + Math.sin(time * 0.8 + tData.id) * 30 * progress;
          
          const scale = fov / (fov + y3d + zOffset);
          const x2d = cx + x3d * scale;
          const y2d = cy + Math.sin(time)*15 + z3d * scale - y3d * scale * 0.3; 
          
          points.push({ x: x2d, y: y2d, scale, progress, y3d });
        }

        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i+1];
          const depthFactor = Math.max(0.1, p1.scale);
          const thickness = (1 - p1.progress) * 30 * depthFactor + 2;
          
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineWidth = thickness;
          ctx.lineCap = 'round';
          
          let strokeColor = `rgba(${30 * depthFactor}, ${50 * depthFactor}, ${80 * depthFactor}, 0.9)`;
          
          if (state === 'processing_subs') {
            const pulse = Math.sin(p1.progress * 25 - time * 12);
            if (pulse > 0.7) {
              strokeColor = `rgba(0, 243, 255, ${pulse * depthFactor})`;
              ctx.shadowBlur = 10 * depthFactor;
              ctx.shadowColor = '#00f3ff';
            } else {
              ctx.shadowBlur = 0;
            }
          } else if (state === 'processing_main') {
            const pulse = Math.sin(p1.progress * 25 + time * 15);
            if (pulse > 0.7) {
              strokeColor = `rgba(176, 38, 255, ${pulse * depthFactor})`;
              ctx.shadowBlur = 15 * depthFactor;
              ctx.shadowColor = '#b026ff';
            } else {
              ctx.shadowBlur = 0;
            }
          } else {
            ctx.shadowBlur = 0;
          }
          
          ctx.strokeStyle = strokeColor;
          ctx.stroke();
          
          if (i % 4 === 0 && i > 5) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const angle = Math.atan2(dy, dx);
            const suckerDist = thickness * 0.55;
            
            const sx = p1.x + Math.cos(angle + Math.PI / 2) * suckerDist;
            const sy = p1.y + Math.sin(angle + Math.PI / 2) * suckerDist;
            
            ctx.beginPath();
            ctx.ellipse(sx, sy, thickness * 0.3, thickness * 0.15, angle, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(15, 23, 42, 0.9)`;
            ctx.fill();
            ctx.strokeStyle = `rgba(125, 211, 252, 0.4)`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        const endP = points[points.length - 1];
        ctx.beginPath();
        const subRadius = 15 * endP.scale;
        ctx.arc(endP.x, endP.y, subRadius, 0, Math.PI * 2);
        
        if (state === 'processing_subs') {
          ctx.fillStyle = '#00f3ff';
          ctx.shadowBlur = 25 * endP.scale;
          ctx.shadowColor = '#00f3ff';
        } else {
          ctx.fillStyle = '#0f172a';
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.strokeStyle = state === 'processing_subs' ? '#ffffff' : '#38bdf8';
        ctx.lineWidth = 2 * endP.scale;
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      renderQueue.forEach(item => {
        if (item.type === 'head') drawHead();
        else drawTentacle(item);
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />;
});


// --- 8つの視点（サブ脳）の定義 ---
const SUB_BRAIN_PERSPECTIVES = [
  "論理的・分析的視点 (事実とデータに基づき客観的に分析)",
  "感情的・共感的視点 (人々の感情や心理的影響を重視)",
  "創造的・革新的視点 (斬新なアイデアや型破りな解決策を提案)",
  "批判的・リスク管理視点 (潜在的な問題点や最悪のシナリオを想定)",
  "歴史的・長期的視点 (過去の事例や将来の持続可能性を考慮)",
  "経済的・効率的視点 (コスト、リソース、費用対効果を重視)",
  "倫理的・社会的視点 (道徳性、公平性、社会への影響を評価)",
  "実用的・技術的視点 (実現可能性や具体的な実行手順に焦点)"
];

// --- Gemini API連携関数 (システムプロンプトを受け取るように拡張) ---
const fetchGeminiResponse = async (prompt, systemInstructionText) => {
  const apiKey = ""; // 実行環境から自動提供
  const maxRetries = 5;
  let delay = 1000; // 1s, 2s, 4s, 8s, 16s とバックオフ

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { 
      parts: [{ text: systemInstructionText }] 
    }
  };

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "エラー: 回答を生成できませんでした。";
    } catch (e) {
      if (i === maxRetries - 1) return "通信エラーが発生しました。ネットワーク接続を確認し、しばらく経ってから再度お試しください。";
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
};


// --- メインアプリケーション ---
export default function App() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      content: '起動完了。私は「OctoBrain」。8基のエッジノードによる多角分析と、メインコアによる統合処理がオンラインです。分析したい対象を入力してください。'
    }
  ]);
  const [input, setInput] = useState('');
  // 状態: 'idle' | 'processing_subs' | 'processing_main'
  const [appState, setAppState] = useState('idle');
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const currentInput = input.trim();
    if (!currentInput || appState !== 'idle') return;

    const userMsg = { id: Date.now(), role: 'user', content: currentInput };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    
    // ==========================================
    // フェーズ1: 8つのサブLLMが並列処理を開始
    // ==========================================
    setAppState('processing_subs');
    
    try {
      // 8つのAPIリクエストをPromise.allで同時に飛ばす
      const subBrainPromises = SUB_BRAIN_PERSPECTIVES.map((perspective, index) => {
        const sysInst = `あなたは「OctoBrain」の8つあるサブ脳のうちの1つ（ノード${index + 1}）です。あなたの役割は「${perspective}」から対象を分析することです。メイン脳に報告するため、要点を2〜3文で非常に簡潔に出力してください。`;
        return fetchGeminiResponse(currentInput, sysInst);
      });
      
      // 全てのサブ脳の回答を待つ
      const subBrainResults = await Promise.all(subBrainPromises);
      
      // ==========================================
      // フェーズ2: メインLLMが情報を統合
      // ==========================================
      setAppState('processing_main');
      
      const mainSysInst = "あなたは「OctoBrain」という最新鋭のタコ型AIの『メイン脳』です。8つの超軽量サブ脳（エッジノード）が異なる視点から収集・分析したレポートを受け取り、それらを統合して最終的な結論を導き出してください。回答する際は、知的でありながらも少しサイバーパンクや生物的な雰囲気を持たせ、「8つの視点を統合したこと」を明確に示しつつ、あなたの意見として見事にまとめてください。";
      
      // サブ脳の回答をプロンプトに構築
      let mainPrompt = `【ユーザーからの指示・質問】\n${currentInput}\n\n【8つのサブ脳からの報告レポート】\n`;
      subBrainResults.forEach((result, idx) => {
        const perspectiveName = SUB_BRAIN_PERSPECTIVES[idx].split(' ')[0];
        mainPrompt += `--- ノード${idx + 1} (${perspectiveName}) ---\n${result}\n\n`;
      });
      mainPrompt += "以上の報告を統合し、ユーザーへの最終回答を生成してください。";
      
      // メインAPI呼び出し
      const finalReply = await fetchGeminiResponse(mainPrompt, mainSysInst);
      
      // ==========================================
      // フェーズ3: 回答完了
      // ==========================================
      setAppState('idle');
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'assistant',
          content: finalReply
        }
      ]);

    } catch (error) {
      console.error(error);
      setAppState('idle');
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'assistant',
          content: "システムエラー：ニューラルネットワークの同期に失敗しました。"
        }
      ]);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 overflow-hidden flex flex-col">
      <OctopusCanvas appState={appState} />

      <header className="relative z-10 p-5 flex justify-center items-center backdrop-blur-md bg-slate-950/40 border-b border-slate-800/60 shadow-lg shadow-black/50">
        <div className="flex items-center gap-3">
          <BrainCircuit className="w-8 h-8 text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 tracking-wider">
            OctoBrain AI
          </h1>
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-8 space-y-6 flex flex-col pt-10 pb-40 scroll-smooth">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-4 max-w-4xl ${
              msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
            } animate-in fade-in slide-in-from-bottom-4 duration-500`}
          >
            <div
              className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center border-2 shadow-lg ${
                msg.role === 'user'
                  ? 'bg-cyan-950/60 border-cyan-500/50 shadow-cyan-500/20'
                  : 'bg-purple-950/60 border-purple-500/50 shadow-purple-500/20'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="w-6 h-6 text-cyan-300" />
              ) : (
                <BrainCircuit className="w-6 h-6 text-purple-300" />
              )}
            </div>

            <div
              className={`p-5 rounded-2xl backdrop-blur-xl shadow-2xl text-sm md:text-base leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-cyan-900/30 border border-cyan-800/50 rounded-tr-sm text-cyan-50'
                  : 'bg-slate-900/70 border border-purple-900/40 rounded-tl-sm text-slate-100 whitespace-pre-wrap'
              }`}
            >
              {msg.content.split('\n').map((line, i) => (
                <React.Fragment key={i}>
                  {line}
                  {i !== msg.content.split('\n').length - 1 && <br />}
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}

        <div className="h-10 flex items-center justify-center transition-all duration-300">
          {appState === 'processing_subs' && (
            <div className="flex items-center gap-3 text-cyan-400 animate-pulse bg-cyan-950/60 px-5 py-2.5 rounded-full border border-cyan-500/40 backdrop-blur-lg shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <Cpu className="w-5 h-5" />
              <span className="text-sm md:text-base font-semibold tracking-wide">8基のエッジノードが並列解析中...</span>
            </div>
          )}
          {appState === 'processing_main' && (
            <div className="flex items-center gap-3 text-purple-400 animate-pulse bg-purple-950/60 px-5 py-2.5 rounded-full border border-purple-500/40 backdrop-blur-lg shadow-[0_0_15px_rgba(168,85,247,0.3)]">
              <Sparkles className="w-5 h-5" />
              <span className="text-sm md:text-base font-semibold tracking-wide">メイン頭脳が結果を統合・生成中...</span>
            </div>
          )}
        </div>
        
        <div ref={messagesEndRef} className="h-4" />
      </main>

      <footer className="absolute bottom-0 left-0 right-0 z-20 p-4 md:p-6 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent">
        <div className="max-w-4xl mx-auto">
          <form
            onSubmit={handleSubmit}
            className={`relative flex items-center bg-slate-900/80 backdrop-blur-2xl border-2 rounded-full shadow-2xl transition-all duration-500 overflow-hidden ${
              appState === 'idle' ? 'border-slate-700/60 focus-within:border-cyan-500/60 focus-within:shadow-cyan-500/20' : 
              appState === 'processing_subs' ? 'border-cyan-500/50 shadow-cyan-500/20' : 'border-purple-500/50 shadow-purple-500/20'
            }`}
          >
            <div className="pl-5 pr-2 text-slate-400">
              <Bot className="w-6 h-6" />
            </div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={appState !== 'idle'}
              placeholder="OctoBrainに分析を依頼する..."
              className="flex-1 bg-transparent border-none py-4 px-2 text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-60 text-base"
            />
            <button
              type="submit"
              disabled={!input.trim() || appState !== 'idle'}
              className="m-2 p-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 disabled:from-slate-800 disabled:to-slate-800 text-white rounded-full transition-all duration-300 disabled:opacity-50 shadow-lg"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <p className="text-center text-xs font-mono text-slate-600 mt-3 tracking-widest">
            OCTOBRAIN ARCHITECTURE: 1 MAIN_CORE + 8 EDGE_NODES
          </p>
        </div>
      </footer>
    </div>
  );
}
