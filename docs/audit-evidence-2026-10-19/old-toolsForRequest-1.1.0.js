function toolsForRequest(request) {
	const text = request.toLocaleLowerCase("tr-TR");
	const android = /android|\bapk\b|\baab\b|gradle|emülatör|emulator|adb|mobil|mobile|\bvpn\b/.test(text);
	const web = /\bweb\b|\bwebsite\b|\bsite\b|\bapi\b|rest|backend|back-end|frontend|front-end|veritabanı|database|sql|html|css|javascript|typescript|react|next\.js|vue|vite|express|fastapi|django|flask|asp\.net|web uygulaması/i.test(text);
	const windows = /windows|masaüstü|desktop|winforms|winui|\bwpf\b|pyside|pyqt|tkinter|pyinstaller|electron|tauri|cmake|inno setup|\bexe\b|kurulum paketi/i.test(text);
	const network = /ağ envanter|network inventory|cidr|tcp port|port tara/i.test(text);
	const rename = /yeniden adlandır|dosya adını değiştir|rename|move file|taşı.*dosya/i.test(text);
	const remove = /sil|kaldır|delete|remove file/i.test(text);
	const powershell = /powershell|registry|regedit|windows service|windows hizmet/i.test(text);
	const logs = /log analizi|günlük.*(ara|analiz|incele)|analyze logs|log file/i.test(text);
	const fileDiscovery = /dosya|dizin|klasör|pdf|excel|word|docx|xlsx|ppt|resim|fotoğraf|video|müzik|arşiv|zip|indeks|dupe|kopya|yinelen/i.test(text);
	const duplicateHunt = /kopya|yinelen|duplicate|ayn(?:ı|i)\s*içerik/i.test(text);
	const softwareIntent = /y[üu]kl[üu]|kurulu|program(lar)?|yaz[ıi]l[ıi]m(lar)?|uygulama(lar)?(ında|da)?|adapt[öo]r|s[üu]r[üu]m|versiyon|hangi edit[öo]r|kod edit[öo]r|ba[şs]lat/i.test(text);
	const capabilityIntent = /eksik|yetenek|gerekli program|capability|nas[ıi]l a[çc]ar[ıi]m|hangi program/i.test(text);
	const adapterIntent = /adapt[öo]r|git |npm |pip |pytest|ollama |docker |vs ?code|dotnet|gradle/i.test(text);
	const researchIntent = /ara[şs]t[ıi]r|internet(?:ten|te)|web aramas?|güncel|nas[ıi]l [çc][öo]z(?:[üu]l[üu]r|erim)?|neden(?:\s+\p{L}+){0,4}\s?çal[ıi][şs]m[ıi]?yor|hatan?[ıi]n?\s+nedeni|stackoverflow|microsoft (?:learn|docs)|github (?:issue|repo|depo|hatt[ıi])|s[üu]r[üu]m notu|uyumluluk|dok[üu]mantasyon|teknik makale|hata .*(?:ara|bul|ç[öo]z)|ç[öo]z[üu]m(?:[üu])?\s+(?:ara|bul)|daha önce (?:ç[öo]z|oldu|kar[şs][ıi]la)|ge[çc]mi[şs] (?:eski|ç[öo]z|kayıt)|hat[ıi]rl(?:[ıi]yor|a)/iu.test(text);
	return agentTools.filter((tool) => {
		const name = tool.function.name;
		if (androidToolNames.has(name) && !android) return false;
		if (webToolNames.has(name) && !web) return false;
		if (windowsToolNames.has(name) && !windows) return false;
		if (researchToolNames.has(name) && !researchIntent) return false;
		if (name === "network_inventory" && !network) return false;
		if (name === "rename_path" && !rename) return false;
		if (name === "delete_file" && !remove) return false;
		if (name === "run_powershell" && !powershell) return false;
		if (name === "analyze_logs" && !logs) return false;
		if ((name === "find_files" || name === "search_file_contents") && !fileDiscovery) return false;
		if (name === "find_duplicate_files" && !duplicateHunt) return false;
		if (name === "file_index_refresh" && !/indeks/i.test(text)) return false;
		if (name === "software_inventory" && !softwareIntent) return false;
		if (name === "run_app_action" && !adapterIntent) return false;
		if (name === "check_capabilities" && !(capabilityIntent || softwareIntent)) return false;
		return true;
	});
}