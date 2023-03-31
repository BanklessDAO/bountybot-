const MiscUtils = {

	// For a string that is within parentheses, add another phrase to it after a comma
	addToTitle(title?: string, titleAddition?: string): string {
		if (title) {
		  return `${title.slice(0, -1)}, ${titleAddition}${title.slice(-1)}`;
		} else {
		  return `(${titleAddition?.charAt(0).toUpperCase() + titleAddition?.slice(1)})`;
		}
	},

	// Simple word wrap. Break at next word after N charcters
	wordWrap(str: string, N: number): string {
		if (str.length <= N) {
		  return str;
		}
	  
		let result = '';
		let line = '';
	  
		for (const word of str.split(' ')) {
		  if (line.length + word.length <= N) {
			line += word + ' ';
		  } else {
			result += line.trim() + '\n';
			line = word + ' ';
		  }
		}
	  
		return result + line.trim();
	  }

};

export default MiscUtils;