using Tesslo.Link;

var port = args.Length > 0 && int.TryParse(args[0], out var parsed) ? parsed : 20111;
using var server = new LinkServer(port);
server.Run();
