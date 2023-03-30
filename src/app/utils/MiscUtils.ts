const MiscUtils = {

	addToTitle(title?: string, titleAddition?: string): string {
		if (title) {
		  return `${title.slice(0, -1)}, ${titleAddition}${title.slice(-1)}`;
		} else {
		  return `(${titleAddition?.charAt(0).toUpperCase() + titleAddition?.slice(1)})`;
		}
	},

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