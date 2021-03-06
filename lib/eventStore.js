//     lib/eventStore.js v0.3.0
//     (c) 2012 Kaba AG, MIC AWM; under MIT License
//     (by) Jan Muehlemann (jamuhl)
//        , Adriano Raiano (adrai)

// The eventstore is the main module delegating all work to it's _eventDispatcher_, _storage implementation_, ...
//
// __Example:__
//
//      var eventstore = require('[pathToEventStore]/eventStore') 
//      var es = eventstore.createStore({
//          publishingInterval: 200, // milliseconds [optional]
//          logger: 'console' // use consoleLogger [optional]
//      });
//      
//      // configure the instance
//      es.configure(function() {
//          var store = es;
//          store.use([myStorage]);
//          store.use([myPublisher]);
//          store.use([myLogger]);
//      }
//      
//      // start the instance
//      es.start()

var eventDispatcher = require('./eventDispatcher') 
  , interfaces = require('./interfaces')
  , util =  require('./util')
  , async = require('async')
  , root = this
  , eventStore
  , Store;

if (typeof exports !== 'undefined') {
    eventStore = exports;
} else {
    eventStore = root.eventStore = {};
}

eventStore.VERSION = '0.3.0';

// Create new instance of the event store.
eventStore.createStore = function(options) {
    return new Store(options);
};

// ## EventStore
Store = function(options) {
    this.options = options || {};
    
    this.storage = undefined;
    this.publisher = undefined;
    this.logger = undefined;
    this.dispatcher = undefined;
};


Store.prototype = {
    
    // __start:__ will inject missing modules by using default inMemory or fake instances and 
    // finally start the dispatcher to publish undispatched (not yet published) events.
    start: function() {
        if (!this.logger && this.options.logger === 'console') {
            this.use(require('./logger/consoleLogger'));
        }
        
        if (!this.storage) {
            require('./storage/inMemory/storage').createStorage(function(err, storage) {
                this.use(storage);
            }.bind(this));
        }
        
        if (!this.publisher) {
            this.use(require('./publisher/fakePublisher').createPublisher());
        }
    
        this.dispatcher = eventDispatcher.create(this);
        this.dispatcher.start();
    },
    
    // __configure:__ configure your eventstore to use wished modules   
    //
    // __Example:__
    //
    //      var eventstore = require('[pathToEventStore]/eventStore') 
    //      var es = eventstore.createStore();
    //      
    //      // configure the instance
    //      es.configure(function() {
    //          var store = es;
    //          store.use([myStorage]);
    //          store.use([myPublisher]);
    //          store.use([myLogger]);
    //      }
    configure: function(fn) {
        fn.call(this);
        return this;
    },
    
    // __use:__ use this function to inject your implementation for following:
    //
    // - __logger:__ use your on implementation or pass in the option `{logger: 'console'}` to use our console logger
    // - __storage:__ default will be set to a inMemory implementation (dev usage only!) but you can choose from a wide variation (mongoDb, redis, couchDb)
    // - __publisher:__ default will be a fakePublisher (dev usage only!). Be sure to pass in your own implementation, which has to provide the function _publish_
    use: function(module) {
        if (!module) return;
    
        if (util.checkInterface(module, interfaces.IStorage, {silent: true})) {
            this.storage = module;
        }
        
        if (util.checkInterface(module, interfaces.IPublisher, {silent: true})) {
            this.publisher = module;
        }
        
        if (util.checkInterface(module, interfaces.ILogger, {silent: true})) {
            this.logger = module;
        }
    },
    
    // __log:__ Just a helper function to shorten logging calls
    log: function(msg, level) {
        if (!this.logger)
            return;
            
        if (level) {
            this.logger[level](msg);
        } else {
            this.logger.info(msg);
        }    
    },
    
    // __hasConfigurationErrors:__ Another helper function to checks for configuration errors as we need at least a 
    // storage implementation at most parts.
    hasConfigurationErrors: function(callback) {
        var err;
        
        if (!this.storage) {
            err = new Error('Configure EventStore to use a storage implementation.');
        }
           
        if (err && callback) {
            callback(err);
        }
            
        return err;
    },
    
    // __getFromSnapshot:__ loads the next snapshot back from given max revision or the latest if you 
    // don't pass in a _maxRev_. In addition you will get the _eventstream_ from snapshot's revision
    // to the given _maxRev_.
    // 
    // `eventStore.getFromSnapshot(streamId, maxRev, callback)`
    //
    // - __streamId:__ id for requested stream (equal to aggregateId)
    // - __maxRev:__ revision endpoint (hint: -1 = to end)
    // - __callback:__ `function(err, snapshot, eventStream){}`
    getFromSnapshot: function(streamId, maxRev, callback) {
            
        if (this.hasConfigurationErrors(callback)) return;
        
        if (typeof maxRev === 'function') {
            callback = maxRev;
            maxRev = -1;
        }
        
        var self = this
          , snapshot
          , eventStream;
         
        async.waterfall([
            
            function getSnapshot(callback) {
                self.storage.getSnapshot(streamId, maxRev, callback);
            },
            
            function getEventStream(snap, callback) {
                var rev = 0;

                if (snap && snap.revision !== undefined) {
                    rev = snap.revision + 1;
                }

                self.getEventStream(streamId, rev, maxRev, function(err, stream) {
                    if (err) callback(err);
                    
                    snapshot = snap;
                    eventStream = stream;
                    callback(null);
                });
            }],
            
            function (err) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, snapshot, eventStream);
                }
            }
        );        
    },
    
    // __createSnapshot:__ stores a new snapshot
    // 
    // `eventStore.createSnapshot(streamId, revision, data, callback)`
    //
    // - __streamId:__ id for requested stream (equal to aggregateId)
    // - __revision:__ revision - current revision state of the aggregate
    // - __data:__ the snaphot to store
    // - __callback:__ `function(err){}` [optional]
    createSnapshot: function(streamId, revision, data, callback) {
        
        if (this.hasConfigurationErrors(callback)) return;
        
        var snapshot = new Snapshot(null, streamId, revision, data);
        
        var self = this;
        
        async.waterfall([
            
            function getNewIdFromStorage(callback) {
                self.storage.getId(callback);
            },
            
            function commit(id, callback) {
                self.log('get new id "' + id + '" from storage');
                snapshot.id = id; 
                self.storage.addSnapshot(snapshot, callback);
            }],
            
            function (err) {
                if (err) {
                    if (callback) callback(err);
                } else {
                    self.log('added new snapshot: ' + JSON.stringify(snapshot));
                    if (callback) callback(null);
                }
            }
        );  
    },
    
    // __getEventStream:__ loads the eventstream from _minRev_ to _maxRev_.
    // 
    // `eventStore.getEventStream(streamId, minRev, maxRev, callback)`
    //
    // - __streamId:__ id for requested stream (equal to aggregateId)
    // - __minRev:__ revision startpoint
    // - __maxRev:__ revision endpoint (hint: -1 = to end) [optional]
    // - __callback:__ `function(err, snapshot, eventStream){}`
    getEventStream: function(streamId, revMin, revMax, callback) {
        
        if (this.hasConfigurationErrors(callback)) return;
        
        if (typeof revMax === 'function') {
            callback = revMax;
            revMax = -1;
        }
        
        var self = this;
        this.storage.getEvents(streamId, revMin, revMax, function(err, events) {
            if (err) {
                callback(err);
            } else {
                callback(null, new EventStream(self, streamId, events));
            }
        });
        
    },
    
    // __commit:__ commits all uncommittedEvents in the eventstream.
    //
    // __hint:__ directly use the commit function on eventstream
    // 
    // `eventStore.commit(eventstream, callback)`
    //
    // - __eventstream:__ the eventstream object
    // - __callback:__ `function(err, eventStream){}`
    commit: function(eventstream, callback) {
    
        if (this.hasConfigurationErrors(callback)) return;
    
        self = this;
        
        async.waterfall([
            
            function getNewCommitId(callback) {
                self.storage.getId(callback);
            },
            
            function commitEvents(id, callback) {
                // start committing.
                var event
                  , currentRevision = eventstream.currentRevision();
            
                for (i = 0, len = eventstream.uncommittedEvents.length; i < len; i++) {
                    event = eventstream.uncommittedEvents[i];
                    event.commitId = id;
                    event.commitSequence = i;
                    event.commitStamp = new Date();
                    currentRevision++;
                    event.streamRevision = currentRevision;
                }
                
                self.storage.addEvents(eventstream.uncommittedEvents, function(err) {
                    if (err) callback(err); 
                });
                
                // push to undispatchedQueue
                self.dispatcher.addUndispatchedEvents(eventstream.uncommittedEvents);
                
                // move to events and remove uncommitted events.
                eventstream.events = eventstream.events.concat(eventstream.uncommittedEvents);
                eventstream.uncommittedEvents = [];
                
                callback(null);
            }],
            
            function (err) {
                if (err) {
                    if (callback) callback(err);
                } else {
                    if (callback) callback(null, eventstream);
                }
            }
        );
    },

    // __getNewIdFromStorage:__ loads a new id from storage.
    //
    // `eventStore.getNewIdFromStorage(callback)`
    //
    // - __callback:__ `function(err, id){}`
    getNewIdFromStorage: function(callback) {

        if (this.hasConfigurationErrors(callback)) return;

        this.storage.getId(callback);
        
    },
    
    // __getAllEvents:__ loads the events from given storage.
    //
    // __warning:__ don't use this in production!!!
    // 
    // `eventStore.getAllEvents(callback)`
    //
    // - __callback:__ `function(err, events){}`
    getAllEvents: function(callback) {
        
        if (this.hasConfigurationErrors(callback)) return;
            
        this.storage.getAllEvents(function(err, events) {
            
            if (typeof callback === 'function') {
                callback(err, events);
            }
        });

    },

    // __getEvents:__ loads the events from given storage.
    // 
    // `eventStore.getEvents(index, amount, callback)`
    //
    // - __index:__ entry index
    // - __amount:__ amount of events
    // - __callback:__ `function(err, events){}`
    getEvents: function(index, amount, callback) {
        
        if (this.hasConfigurationErrors(callback)) return;
            
        this.storage.getEventRange(index, amount, function(err, events) {
            
            if (typeof callback === 'function') {
                callback(err, events);
            }
        });

    }

};

// ## EventStream
// The eventstream is one of the main objects to interagate with the eventstore
//
// - __events:__ all events which are already committed (aggregate history)
// - __uncommittedEvents:__ all uncommittedEvents
var EventStream = function(store, streamId, events) {
    this.store = store;
    this.streamId = streamId;
    this.events = events || [];
    this.uncommittedEvents = [];
    this.lastRevision = -1;
};

EventStream.prototype = {

    // __currentRevision:__  This helper function returns the current stream revision.
    currentRevision: function() {
        var rev = this.lastRevision;
        
        for (i = 0, len = this.events.length; i < len; i++) {
            if (this.events[i].streamRevision > rev) {
                rev = this.events[i].streamRevision;
            }
        }
        
        return rev;
    },

    // __addEvent:__ adds an event to the uncommittedEvents array
    //
    // `eventstream.addEvent(event)`
    //
    // - __event:__ your event object
    addEvent: function(event) {
        var evt = new Event(this.streamId, event);
        this.uncommittedEvents.push(evt);
    },
    
    // __commit:__ commits all uncommittedEvents
    //
    // `eventstream.commit(callback)
    //
    // - __callback:__ `function(err){}` [optional]
    commit: function(callback) {
        this.store.commit(this, callback);
    }
};

// ## Event
// The event object will be persisted to the storage. The orginal event will be saved in _payload_.
var Event = function(streamId, event) {
    this.streamId = streamId || null;
    this.streamRevision = null;
    this.commitId = null;
    this.commitSequence = null;
    this.commitStamp = null;
    this.header = null;
    this.dispatched = false;
    this.payload = event || null;    
};

// ## Snapshot
// The snapshot object will be persisted to the storage. The orginal data will be saved in _data_.
var Snapshot = function(id, streamId, revision, data) {
    this.id = id;
    this.streamId = streamId;
    this.revision = revision;
    this.data = data;
};

// attach public classes
Store.Event = Event;
Store.EventStream = EventStream;
