import { Arrow, Rect, Text, Circle } from "react-konva";
import type { Annotation } from "./editorStore";

// ── Annotation renderer ────────────────────────────────────────────────────

export function AnnotationNode({
  ann,
  isSelected,
  onSelect,
}: {
  ann: Annotation;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const p = ann.props;
  const handleClick = () => onSelect(ann.id);

  if (ann.type === "arrow") {
    return (
      <Arrow
        points={p.points}
        stroke={p.color}
        strokeWidth={p.strokeWidth}
        fill={p.color}
        pointerLength={10}
        pointerWidth={8}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "text") {
    return (
      <Text
        x={p.x} y={p.y}
        text={p.text}
        fontSize={p.fontSize}
        fill={p.color}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "rect") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        stroke={p.color}
        strokeWidth={p.strokeWidth}
        fill={p.fill ?? "transparent"}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "highlight") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        fill={p.color}
        listening={false}
        opacity={isSelected ? 0.5 : 1}
      />
    );
  }
  if (ann.type === "blur") {
    return (
      <Rect
        x={p.x} y={p.y} width={p.width} height={p.height}
        fill={p.fill}
        onClick={handleClick}
        opacity={isSelected ? 0.75 : 1}
        draggable
      />
    );
  }
  if (ann.type === "step") {
    return (
      <>
        <Circle
          x={p.x} y={p.y} radius={14}
          fill={p.color}
          onClick={handleClick}
          opacity={isSelected ? 0.75 : 1}
          draggable
        />
        <Text
          x={p.x - 14} y={p.y - 14}
          width={28} height={28}
          text={String(p.step)}
          fontSize={13}
          fontStyle="bold"
          fill="#fff"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </>
    );
  }
  return null;
}
