const platformClient = require("platformClient");

Vue.prototype.$clientApp = null;
Vue.prototype.$usersApi = null;
Vue.prototype.$qualityApi = null;
Vue.prototype.$conversationsApi = null;

const authenticatingComponent = {
    props: ['errorMessage', 'authenticated'],
    template: '#authenticating-template'
}

const profileComponent = {
    props: ['profileData'],

    computed: {
        imageUri: function () {
            return processImageData(this.profileData.images);
        }
    },

    methods: {
        profileLinkListener: function(evt) {
            evt.preventDefault();

            if (this.profileData.id) {
                Vue.prototype.$clientApp.users.showProfile(this.profileData.id);
            } else {
                console.info("No user ID available to route to user profile");
            }
        }
    },

    template: '#profile-template'
};

const conversationsComponent = {
    props: ['conversationsData'],

    data: function() {
        return {
            startDate: moment('1997-01-01').toISOString(),
            endDate: moment().toISOString(),
            titles: [
                "Evaluation Id",
                "Interaction Id",
                "Critical Score",
                "Score",
                "Evaluation Form Name",
                "Evaluator",
                "Release Date/Time",
                "Reviewed By Agent"
            ],
        }
    },

    computed: {
        conversations: function() {
            let filteredConversations = [];
            let sortedConversations = _.orderBy(this.conversationsData.conversations, 'startTime', 'desc');
            if (Array.isArray(sortedConversations)) {
                filteredConversations = sortedConversations.filter((conv) => {
                    if (!this.startDate._isValid) {
                        this.startDate = moment('1970-01-01').toISOString();
                    }
                    if (!this.endDate._isValid) {
                        this.endDate = moment().toISOString();
                    }
                    return conv.id && (conv.endTime ?
                        (moment(conv.startTime).isAfter(moment(this.startDate)) &&
                        moment(conv.endTime).isBefore(moment(this.endDate))):
                        moment(conv.startTime).isBetween(
                            moment(this.startDate),
                            moment(this.endDate)
                        ));
                });
            }
            return filteredConversations;
        },
        convEvalMap: function() {
            return this.conversationsData.convEvalMap;
        }
    },

    methods: {
        filterCards: function(evt) {
            this.startDate = moment(evt.target.elements.starttime.value);
            this.endDate = moment(evt.target.elements.endtime.value);
        },
        viewInteraction: function(convId) {
            Vue.prototype.$clientApp.myConversations.showInteractionDetails(convId);
        },
        viewEvaluation: function(convId, evId) {
            Vue.prototype.$clientApp.myConversations.showEvaluationDetails(convId, evId);
        }
    },

    template: '#conversations-template'
};

const testerComponent = {
    data: function() {
        return {
            convId: "",
            evalId: ""
        }
    },

    methods: {
        viewInteraction: function(convId) {
            Vue.prototype.$clientApp.myConversations.showInteractionDetails(convId);
        },
        viewEvaluation: function(convId, evalId) {
            Vue.prototype.$clientApp.myConversations.showEvaluationDetails(convId, evalId);
        },
        getConversationOrEvaluation: function(evt) {
            if (this.convId) {
                if (this.evalId) {
                    this.viewEvaluation(this.convId, this.evalId);
                } else {
                    this.viewInteraction(this.convId);
                }
            }
        }
    },

    template: '#tester-template'
}

new Vue({
    el: '#app',

    data: {
        profileData: {
            name: "Ron Swanson",
            email: "ron@swanson.com",
            department: "Parks and Rec"
        },
        conversationsData: {
            conversations: [],
            convEvalMap: new Map()
        },
        errorMessage: "",
        authenticated: false
    },

    components: {
        'authenticating': authenticatingComponent,
        'profile': profileComponent,
        'conversations': conversationsComponent,
        'tester': testerComponent
    },

    beforeMount() {
        let pcEnvironment = getEmbeddingPCEnv();
        if (!pcEnvironment) {
            this.errorMessage = 'Cannot identify App Embeddding context.  Did you forget to add pcEnvironment={{pcEnvironment}} to your app\'s query string?';
            return;
        }

        let client = platformClient.ApiClient.instance;
        let clientApp = null;
        try {
            clientApp = new window.purecloud.apps.ClientApp({
                pcEnvironment,
            });
            Vue.prototype.$clientApp = clientApp;
        } catch (e) {
            console.log(e);
            this.errorMessage = pcEnvironment + ": Unknown/Unsupported Genesys Cloud Embed Context";
            return;
        }

        // Create API instance
        const usersApi = new platformClient.UsersApi();
        const qualityApi = new platformClient.QualityApi();
        const conversationsApi = new platformClient.ConversationsApi();
        const externalContactsApi = new platformClient.ExternalContactsApi();
        Vue.prototype.$usersApi = usersApi;
        Vue.prototype.$qualityApi = qualityApi;
        Vue.prototype.$conversationsApi = conversationsApi;
        Vue.prototype.$externalContactsApi = externalContactsApi;

        let authenticated = false;
        let agentUserId = "";

        function getCustomerParticipant(conv) {
            let newConv = conv;
            newConv.customer = newConv.participants.find((part) => {
                return part.purpose === "customer" || part.purpose === "external";
            }) || { name: "Unknown" };
            return newConv.customer
        }

        async function getCustomerName(customer){
            if (customer.externalContactId){
                return externalContactsApi.getExternalcontactsContact(customer.externalContactId)
                    .then((externalContact) => {
                        const name = `${externalContact.firstName} ${externalContact.lastName}`;
                        return Promise.resolve(name)
                    })
            } else{
                if(!customer.name){
                    return Promise.resolve("Unknown")
                } else{
                    return Promise.resolve(customer.name)
                }
            } 
        }

        async function getEvalConversationsData(evaluations){

            const evalConversations = await Promise.all(
                evaluations.map(eval => conversationsApi.getConversation(eval.conversation.id).then(
                    async (conv) => {
                        conv.customer = getCustomerParticipant(conv);
                        const name = await getCustomerName(conv.customer);
                        conv.customer.name = name;
                        return await Promise.resolve(conv);
                    }
                ).catch((err) => {
                    console.log(`Error: ${err}`);
                }))
            );
            return await Promise.resolve(evalConversations);
        }

        // Authentication and main flow
        authenticate(client, pcEnvironment)
            .then(() => {
                authenticated = true;
                return usersApi.getUsersMe({ "expand": ["presence"] });
            })
            .then((profileData) => {
                // Process agent's profile data
                this.profileData = profileData;
                agentUserId = profileData.id;
                this.authenticated = true;

                // Get evaluations data
                const startTime = moment('1997-01-01').toISOString();
                const endTime = moment().toISOString();

                getEvaluations(qualityApi, startTime, endTime, agentUserId)
                    .then((data) => {
                        // Process evaluations data
                        const evaluations = data.entities;
                        getEvalConversationsData(evaluations)
                            .then((evalConversations) => {
                                evalConversations.forEach((evalConv, index) => {
                                    this.conversationsData.conversations.push(evalConv);
                                    this.conversationsData.conversations = _.uniqWith(this.conversationsData.conversations, _.isEqual);
                                    if (this.conversationsData.convEvalMap.has(evalConv.id)) {
                                        this.conversationsData.convEvalMap.get(evalConv.id).push(evaluations[index]);
                                    } else {
                                        this.conversationsData.convEvalMap.set(evalConv.id, [evaluations[index]]);
                                    }
                                })
                            })
                    })
                    .catch((err) => {
                        console.log(`Error: ${err}`);
                    });

                conversationsApi.getConversations()
                    .then((data) => {
                        data.entities.forEach((conv) => {
                            conv.customer = getCustomerParticipant(conv)
                            getCustomerName(conv.customer).then((name) => {
                                conv.customer.name = name
                                this.conversationsData.conversations.push(conv)
                            })
                        });
                        this.conversationsData.conversations = _.uniqWith(this.conversationsData.conversations, _.isEqual);
                    })
                    .catch((err) => {
                        console.log(`Error: ${err}`);
                    });
            })
            .catch((err) => {
                console.log(err);
                this.errorMessage =
                    !authenticated
                        ? "Failed to Authenticate with Genesys Cloud - " + err.message
                        : "Failed to fetch/display profile";
            });
    },
});
