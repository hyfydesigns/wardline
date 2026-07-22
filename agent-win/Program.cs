using WardlineAgent;

// Wardline Windows agent host.
//
// Runs as a Windows Service (SYSTEM, auto-restart). Install with:
//   sc create WardlineAgent binPath= "C:\Program Files\Wardline\wardline-agent.exe" start= auto
//   sc failure WardlineAgent reset= 86400 actions= restart/5000/restart/5000/restart/5000
//
// The service posts device telemetry to the cloud ingest API and runs a
// tamper watchdog. It is intentionally small: the heavy classification lives
// in the cloud, so the on-device footprint stays low.

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService(options => options.ServiceName = "WardlineAgent");
builder.Services.AddHttpClient();
builder.Services.Configure<AgentOptions>(builder.Configuration.GetSection("Wardline"));
builder.Services.AddSingleton<IngestClient>();
builder.Services.AddSingleton<TamperWatchdog>();
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
host.Run();
