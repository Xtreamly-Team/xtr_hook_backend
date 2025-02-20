declare module 'winston-daily-rotate-file' {
	import Transport from 'winston-transport';
	import { Format } from 'logform';

	interface DailyRotateFileOptions extends Transport.TransportStreamOptions {
		filename: string;
		datePattern?: string;
		zippedArchive?: boolean;
		maxSize?: string;
		maxFiles?: string | number;
		dirname?: string;
		extension?: string;
		format?: Format;
		auditFile?: string;
	}

	class DailyRotateFile extends Transport {
		constructor(opts: DailyRotateFileOptions);
	}

	export default DailyRotateFile;
}
