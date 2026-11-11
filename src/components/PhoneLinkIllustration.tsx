import { QrCode } from "../icons";
import { MausAvatar, roomAvatarGradient } from "./Avatar";

export function PhoneLinkIllustration({ scanning = false }: { scanning?: boolean }) {
  return (
    <div aria-hidden="true" className="relative shrink-0 text-ink">
      <div className="relative h-[232px] w-[132px] rounded-[28px] border-2 border-current bg-app p-2">
        <div className="absolute start-1/2 top-2.5 h-1.5 w-9 -translate-x-1/2 rounded-full bg-ink" />
        <div className="flex h-full flex-col justify-center gap-4 px-2 pt-3">
          {scanning ? (
            <div className="flex flex-col items-center gap-5">
              <MausAvatar color="green" gradient={roomAvatarGradient("green")} size={36} animated={false} trackPointer={false} personality={false} eyeInk="var(--color-app)" />
              <QrCode size={52} strokeWidth={1.5} />
            </div>
          ) : (["green", "purple", "orange"] as const).map((color, index) => (
            <div key={color} className="flex items-center gap-2">
              <MausAvatar color={color} gradient={roomAvatarGradient(color)} size={30} animated={false} trackPointer={false} personality={false} eyeInk="var(--color-app)" />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className={`h-1.5 rounded-full bg-ink/20 ${index === 1 ? "w-7" : "w-10"}`} />
                <div className="h-1 w-6 rounded-full bg-ink/10" />
              </div>
            </div>
          ))}
        </div>
        <div className="absolute bottom-2 start-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-ink/20" />
      </div>
      {scanning && <div className="absolute -end-10 top-1/2 w-8 border-t border-dashed border-ink-tertiary" />}
    </div>
  );
}
