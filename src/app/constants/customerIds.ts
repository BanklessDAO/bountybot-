const customers = {
	banklessDAO: '834499078434979890',
	discordBotGarage: '851552281249972254',
	slinkyPotatoServer: '850840267082563596',
	bountyBoardBotServer: '905250069463326740',
	cityDAO: '860356969521217536',
	lifeTheLifeDAO: '721358849034158104',
	shapeShift: '554694662431178782',
	DIMO: '892438668453740634',
	banklessBrasil: '875424808194691113',
	banklessDAOProductSupportCenter: '895442799971942410',
	eco: '768556386404794448',
	ELI5DAO: '1040378471341371502',
};

// Allow adding a test customer from the environment
const customerIds = Object.values(customers);
if (process.env.TEST_CUSTOMER) {
	customerIds.push(process.env.TEST_CUSTOMER);
}

export const guildIds = customerIds;