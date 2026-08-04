interface Props {
  title: string;
  description: string;
  icon: string;
}

export default function PlaceholderPage({ title, description, icon }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4 text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center text-3xl shadow-sm">
        {icon}
      </div>
      <div className="space-y-1.5 max-w-sm">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
      <div className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-border text-xs text-muted-foreground font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        Próximamente — en desarrollo
      </div>
    </div>
  );
}
