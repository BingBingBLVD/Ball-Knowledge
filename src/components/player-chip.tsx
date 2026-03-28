"use client";

import { usePlayerHoverCard } from "./player-hover-card";

interface PlayerAvailability {
  name: string;
  position: string;
  jersey: string;
  status: "Playing" | "Out" | "Doubtful" | "Questionable" | "Day-To-Day";
  injuryNote?: string;
  headshot?: string;
  espnId?: string;
}

interface PlayerChipProps {
  player: PlayerAvailability;
  teamName: string;
  teamAbbr: string;
  variant: "playing" | "gameTime" | "out";
}

const variantStyles = {
  playing: {
    circle: "bg-emerald-100 text-emerald-700",
    ring: "",
    firstName: "text-neutral-700",
    lastName: "text-neutral-500",
    injury: "",
    strikethrough: false,
  },
  gameTime: {
    circle: "bg-amber-100 text-amber-700",
    ring: "ring-2 ring-amber-300",
    firstName: "text-neutral-700",
    lastName: "text-neutral-500",
    injury: "text-amber-600",
    strikethrough: false,
  },
  out: {
    circle: "bg-red-100 text-red-600",
    ring: "",
    firstName: "text-neutral-400",
    lastName: "text-neutral-400",
    injury: "text-red-400",
    strikethrough: true,
  },
};

export function PlayerChip({ player, teamName, teamAbbr, variant }: PlayerChipProps) {
  const { show, move, hide } = usePlayerHoverCard();
  const style = variantStyles[variant];

  const parts = player.name.split(" ");
  const first = parts[0] ?? "";
  const last = parts.slice(1).join(" ") || "";
  const initials = (first[0] ?? "") + (parts[1]?.[0] ?? "");

  return (
    <div
      className="flex flex-col items-center gap-0.5 w-[60px] cursor-pointer"
      onMouseEnter={(e) => show(player, teamName, teamAbbr, e.clientX, e.clientY)}
      onMouseMove={(e) => move(e.clientX, e.clientY)}
      onMouseLeave={hide}
    >
      <div
        className={`size-10 rounded-full flex items-center justify-center text-[10px] font-bold leading-none text-center px-0.5 ${style.circle} ${style.ring} ${style.strikethrough ? "line-through decoration-red-400" : ""}`}
      >
        {player.jersey || initials}
      </div>
      <span className={`text-[10px] font-medium text-center leading-tight w-full truncate ${style.firstName} ${style.strikethrough ? "line-through" : ""}`}>
        {first}
      </span>
      <span className={`text-[10px] text-center leading-tight w-full truncate ${style.lastName} ${style.strikethrough ? "line-through" : ""}`}>
        {last}
      </span>
      {player.injuryNote && style.injury && (
        <span className={`text-[9px] text-center leading-tight truncate w-full ${style.injury}`}>
          {player.injuryNote}
        </span>
      )}
    </div>
  );
}
