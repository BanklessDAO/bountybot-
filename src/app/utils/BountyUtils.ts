import ValidationError from '../errors/ValidationError';
import Log, { LogUtils } from './Log';
import { Role } from 'discord.js';
import DiscordUtils from '../utils/DiscordUtils';
import { URL } from 'url';
import { BountyCollection } from '../types/bounty/BountyCollection';
import { Applicant, Bounty } from '../types/bounty/Bounty';
import { BountyStatus } from '../constants/bountyStatus';
import { CreateRequest } from '../requests/CreateRequest';
const BountyUtils = {
    TWENTYFOUR_HOURS_IN_SECONDS: 24*60*60,

    validateDescription(description: string): void {
        const CREATE_SUMMARY_REGEX = /^[\w\s\W]{1,4000}$/;
        if (description == null || !CREATE_SUMMARY_REGEX.test(description)) {
            throw new ValidationError(
                'Please enter a valid summary: \n' +
                '- 4000 characters maximum\n ' +
                '- alphanumeric\n ' +
                '- special characters: .!@#$%&,?');
        }
    },

    validateCriteria(criteria: string): void {
        const CREATE_CRITERIA_REGEX = /^[\w\s\W]{1,1000}$/;
        if (criteria == null || !CREATE_CRITERIA_REGEX.test(criteria)) {
            throw new ValidationError(
                'Please enter a valid criteria: \n' +
                '- 1000 characters maximum\n ' +
                '- alphanumeric\n ' +
                '- special characters: .!@#$%&,?'
            );
        }
    },

    validateDate(date: string): Date {
        try {
            return new Date(date + 'T00:00:00.000Z');
        } catch (e) {
            LogUtils.logError('failed to validate date', e);
            throw new ValidationError('Please try `UTC` date in format yyyy-mm-dd, i.e 2021-08-15');
        }
    },

    validateTitle(title: string): void {
        const CREATE_TITLE_REGEX = /^[\w\s\W]{1,80}$/;
        if (title == null || !CREATE_TITLE_REGEX.test(title)) {
            throw new ValidationError(
                'Please enter a valid title: \n' +
                '- 80 characters maximum\n ' +
                '- alphanumeric\n ' +
                '- special characters: .!@#$%&,?',
            );
        }
    },

    validateTag(tag: string): void {
        const CREATE_TAG_REGEX = /^[\w\s\W]{1,80}$/;
        if (tag == null || !CREATE_TAG_REGEX.test(tag)) {
            throw new ValidationError(
                'Please enter a valid tag: \n' +
                '- 80 characters maximum\n ' +
                '- alphanumeric\n ' +
                '- special characters: .!@#$%&,?:|-_',
            );
        }
    },

    validateReward(rewardInput: string): void {
        const [stringAmount, symbol] = (rewardInput != null) ? rewardInput.split(' ') : [null, null];
        const ALLOWED_CURRENCIES = ['BANK', 'ETH', 'BTC', 'USDC', 'USDT', 'TempCity', 'gOHM', 'LUSD', 'FOX', 'oneFOX'];
        const isValidCurrency = (typeof symbol !== 'undefined') && (ALLOWED_CURRENCIES.find(element => {
            return element.toLowerCase() === symbol.toLowerCase();
        }) !== undefined);
        const MAXIMUM_REWARD = 100000000.00;

        if (!isValidCurrency) {
            throw new ValidationError(
                '- Specify a valid currency. The accepted currencies are:\n' +
                `${ALLOWED_CURRENCIES.toString()}\n` +
                'Please reach out to your favorite Bounty Board representative to expand this list!',
            );
        }

        const amount: number = Number(stringAmount);
        if (Number.isNaN(amount) || !Number.isFinite(amount) || amount < 0 || amount > MAXIMUM_REWARD) {
            throw new ValidationError(
                'Please enter a valid decimal reward value: \n ' +
                '- 0 minimum, 100 million maximum \n ' +
                'Please reach out to your favorite Bounty Board representative to expand this range!',
            );
        }
    },

    validateEvergreen(evergreen: boolean, claimLimit: number, gateOrAssign: boolean) {
        if (evergreen && gateOrAssign) {
            throw new ValidationError('Cannot use for-role or for-user with multiple-claimant bounties');
        }
        if (claimLimit !== undefined && (claimLimit < 0 || claimLimit > 100)) {
            throw new ValidationError('claimants should be from 0 (meaning infinite) to 100');
        }
    },

    validateRequireApplications(request: CreateRequest) {
        if (request.evergreen && request.requireApplication) {
            throw new ValidationError('Cannot require applications on multi-claimant bounties.');
        }

        // TODO Allow requireApplications on gated bounties
        if (request.requireApplication && (request.assign || request.gate)) {
            throw new ValidationError('Cannot require applications on bounties gated to users or roles.');
        }
    },

    async validateGate(gate: string, guildId: string): Promise<void> {
        try {
            await DiscordUtils.getRoleFromRoleId(gate, guildId);
        }
        catch (e) {
            Log.info(`${gate} is not a valid role on this server`);
            throw new ValidationError('Please choose a valid role on this server.');
        }
    },

    async validateAssign(assign: string, guildId: string, applicants: Applicant[]): Promise<void> {
        if (applicants && !applicants.some(applicant => applicant.discordId == assign)) {
            let applicantList: string = '';
            applicants.forEach( applicant => { applicantList += `\n ${applicant.discordHandle}`});
            throw new ValidationError(`Please choose a user from the list of applicants: ${applicantList}`);
        }
        try {
            await DiscordUtils.getGuildMemberFromUserId(assign, guildId);
        }
        catch (e) {
            Log.info(`User ${assign} is not a user or was unable to be fetched`);
            throw new ValidationError('Please choose a valid user on this server.');
        }
    },

    threeMonthsFromNow(): Date {
        let ts: number = Date.now();
        const date: Date = new Date(ts);
        return new Date(date.setMonth(date.getMonth() + 3));
    },

    formatDisplayDate(dateIso: string): string {
        const options: Intl.DateTimeFormatOptions = {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        };
        return (new Date(dateIso)).toLocaleString('en-US', options);
    },

    validateBountyId(bountyId: string): void {
        Log.debug(`validating bountyId: ${bountyId}`);
        const BOUNTY_ID_REGEX = /^[a-f\d]{24}$/i;
        if ((bountyId == null || !BOUNTY_ID_REGEX.test(bountyId))) {
            throw new ValidationError(
                `Thank you for giving bounty board a try!\n` +
                `Please enter a valid bounty ID, which can be found on the website or in the bounties channel \n` +
                ` - ${process.env.BOUNTY_BOARD_URL}`
            );
        }
    },

    validateUrl(url: string): void {
        try {
            new URL(url);
        }
        catch (e) {
            throw new ValidationError(
                'Please enter a valid url.\n' +
                // TODO: think whether the following line should be here (likely not) or out of utils
                //'Providing a url is not required, but it makes it easier for your work to be reviewed and for your bounty to be paid out.\n' +
                'If you are having trouble, try navigating to the desired url in your browser. Then copy the url directly from your browser address bar\n' +
                'If you have any questions, please reach out to your favourite bouny board representative!'
            );
        }
    },

    validateNotes(notes: string): void {
        const SUBMIT_NOTES_REGEX = /^[\w\s\W]{1,4000}$/;
        if (notes == null || !SUBMIT_NOTES_REGEX.test(notes)) {
            throw new ValidationError(
                'Please enter notes with a maximum of 4000 characters, and the following requirements: \n' +
                '- alphanumeric\n ' +
                '- special characters: .!@#$%&,?'
                // TODO: think whether the following line should be here (likely not) or out of utils
                //'Providing notes is not required, but it makes it easier for your work to be reviewed and for your bounty to be paid out.\n'
            );
        }
    },

    validatePitch(pitch: string): void {
        const SUBMIT_PITCH_REGEX = /^[\w\s\W]{1,4000}$/;
        if (pitch == null || !SUBMIT_PITCH_REGEX.test(pitch)) {
            throw new ValidationError(
                'Please enter a pitch with a maximum of 4000 characters, and the following requirements: \n' +
                '- alphanumeric\n ' +
                '- special characters: .!@#$%&,?'
            );
        }
    },

    getClaimedAt(bountyRecord: BountyCollection): string | null {
        const statusHistory = bountyRecord.statusHistory;
        if (!statusHistory) {
            return null;
        }

        for (const statusRecord of statusHistory) {
            if (statusRecord.status === BountyStatus.in_progress) {
                return statusRecord.setAt;
            }
        }
        return null;
    },

    /**
     * compares whether two Dates are within 24 hours of each other
     * @param one ISO-8601 representation of a date
     * @param two ISO-8601 representation of a date
     */
    isWithin24Hours(one: string, two: string): boolean {
        const dateOne: Date = new Date(one);
        const dateTwo: Date = new Date(two);
        let elapsedSeconds = Math.abs( ( dateOne.getTime() - dateTwo.getTime() ) / 1000 );
        return elapsedSeconds < BountyUtils.TWENTYFOUR_HOURS_IN_SECONDS;
    },

    async createPublicTitle(bountyRecord: Bounty): Promise<string> {
        let title = bountyRecord.title;
        if (bountyRecord.evergreen && bountyRecord.isParent) {
            if (bountyRecord.claimLimit > 1) {
                const claimsAvailable = bountyRecord.claimLimit - (bountyRecord.childrenIds !== undefined ? bountyRecord.childrenIds.length : 0);
                title += `\n(${claimsAvailable} claim${claimsAvailable !== 1 ? "s" : ""} available)`;
            } else {
                title += '\n(Infinite claims available)';
            }
        }
        if (bountyRecord.assign) {
            title += `\n(For user ${bountyRecord.assignedName})`
        } else if (bountyRecord.gate) {
            const role: Role = await DiscordUtils.getRoleFromRoleId(bountyRecord.gate[0], bountyRecord.customerId);
            title += `\n(For role ${role.name})`;
        } else if (bountyRecord.isIOU) {
            title += `\n(IOU owed to ${bountyRecord.owedTo.discordHandle})`;
        } else {    
            if (bountyRecord.requireApplication) {
                title += `\n(Requires application before claiming`;
                if (bountyRecord.applicants) {
                    if (bountyRecord.applicants.length == 1) {
                        title += `. 1 applicant so far.`;
                    } else {
                        title += `. ${bountyRecord.applicants.length} applicants so far.`;
                    }
                }
                title += ')'
            }
        }
        return title;
    
    }
}

export default BountyUtils;