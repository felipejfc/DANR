'use client';

import { useEffect, useRef, useState } from 'react';
import { FlameGraphNode } from '@/lib/api';

interface FlameGraphProps {
  data: FlameGraphNode;
  width?: number;
  height?: number;
  onFrameClick?: (frame: FlameGraphNode) => void;
}

interface RenderedNode {
  node: FlameGraphNode;
  x: number;
  y: number;
  width: number;
  depth: number;
}

const CELL_HEIGHT = 20;
const MIN_WIDTH_FOR_TEXT = 40;

// Color palette for flame graph (warm colors)
const COLORS = [
  '#ff6b6b', '#ff8787', '#ffa8a8', '#ffc9c9',
  '#ff922b', '#ffa94d', '#ffc078', '#ffd8a8',
  '#fcc419', '#ffd43b', '#ffe066', '#ffec99',
  '#94d82d', '#a9e34b', '#c0eb75', '#d8f5a2',
];

function getColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function flattenTree(
  node: FlameGraphNode,
  x: number,
  width: number,
  depth: number,
  totalValue: number
): RenderedNode[] {
  const result: RenderedNode[] = [];

  if (node.value > 0) {
    result.push({ node, x, y: depth * CELL_HEIGHT, width, depth });
  }

  let childX = x;
  for (const child of node.children) {
    const childWidth = (child.value / totalValue) * width;
    if (childWidth >= 1) {
      result.push(...flattenTree(child, childX, childWidth, depth + 1, totalValue));
      childX += childWidth;
    }
  }

  return result;
}

export default function FlameGraph({ data, width: propWidth, height: propHeight, onFrameClick }: FlameGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: propWidth || 800, height: propHeight || 400 });
  const [hoveredNode, setHoveredNode] = useState<FlameGraphNode | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<{ node: FlameGraphNode; x: number; width: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: propWidth || entry.contentRect.width,
          height: propHeight || Math.max(400, entry.contentRect.height),
        });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [propWidth, propHeight]);

  const rootNode = zoom?.node || data;
  const rootWidth = zoom?.width || dimensions.width;

  const nodes = flattenTree(rootNode, 0, rootWidth, 0, rootNode.value);
  const maxDepth = Math.max(...nodes.map(n => n.depth), 0);
  const chartHeight = (maxDepth + 1) * CELL_HEIGHT + 40;

  const handleMouseMove = (e: React.MouseEvent) => {
    setTooltipPosition({ x: e.clientX + 10, y: e.clientY + 10 });
  };

  const handleClick = (node: FlameGraphNode) => {
    if (node === data || node === zoom?.node) {
      setZoom(null);
    } else {
      const nodeRender = nodes.find(n => n.node === node);
      if (nodeRender) {
        setZoom({ node, x: nodeRender.x, width: nodeRender.width });
      }
    }
    onFrameClick?.(node);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {zoom && (
        <button
          onClick={() => setZoom(null)}
          className="absolute top-2 right-2 z-10 px-3 py-1 text-sm bg-gray-800 text-white rounded hover:bg-gray-700"
        >
          Reset Zoom
        </button>
      )}

      <svg
        width={dimensions.width}
        height={chartHeight}
        className="flame-graph"
        onMouseMove={handleMouseMove}
      >
        {nodes.map((renderedNode, index) => {
          const { node, x, y, width } = renderedNode;
          const color = getColor(node.name);
          const showText = width > MIN_WIDTH_FOR_TEXT;

          return (
            <g
              key={`${node.name}-${index}`}
              onMouseEnter={() => setHoveredNode(node)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => handleClick(node)}
              className="cursor-pointer"
            >
              <rect
                x={x}
                y={y}
                width={Math.max(width - 1, 1)}
                height={CELL_HEIGHT - 1}
                fill={hoveredNode === node ? '#4a4a4a' : color}
                stroke="#333"
                strokeWidth={0.5}
                rx={2}
              />
              {showText && (
                <text
                  x={x + 4}
                  y={y + CELL_HEIGHT / 2 + 4}
                  fontSize={11}
                  fill="#000"
                  className="pointer-events-none select-none"
                >
                  {node.name.length > Math.floor(width / 7)
                    ? node.name.substring(0, Math.floor(width / 7) - 2) + '...'
                    : node.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hoveredNode && (
        <div
          className="fixed z-50 bg-gray-900 text-white px-3 py-2 rounded shadow-lg text-sm max-w-md"
          style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
        >
          <div className="font-mono font-semibold break-all">{hoveredNode.name}</div>
          <div className="text-gray-300 mt-1">
            Samples: {hoveredNode.value} ({((hoveredNode.value / data.value) * 100).toFixed(1)}%)
          </div>
          <div className="text-gray-400 text-xs mt-1">Click to zoom</div>
        </div>
      )}
    </div>
  );
}
